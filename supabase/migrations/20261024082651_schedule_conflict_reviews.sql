BEGIN;
CREATE TABLE rejoyce_security.schedule_conflict_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL REFERENCES public.users(id), action text NOT NULL, payload jsonb NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX schedule_conflict_reviews_actor ON rejoyce_security.schedule_conflict_reviews(organization_id,actor_id,created_at);
CREATE TABLE rejoyce_security.schedule_conflict_acknowledgements(
 review_id uuid PRIMARY KEY REFERENCES rejoyce_security.schedule_conflict_reviews(id), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 record_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 staff_reviewed boolean NOT NULL, children_reviewed boolean NOT NULL, uncertainty_reviewed boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE rejoyce_security.schedule_conflict_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.schedule_conflict_acknowledgements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.schedule_conflict_reviews,rejoyce_security.schedule_conflict_acknowledgements FROM PUBLIC,anon,authenticated;

-- Whitelisted DTO; all identities must belong to the caller's current tenant.
CREATE FUNCTION rejoyce_security.conflict_proposal(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; children uuid[]; staff uuid[]; from_at timestamptz; to_at timestamptz; excluded uuid; kind text; skip boolean:=false;
 s public.sessions%rowtype; next_s public.sessions%rowtype; g rejoyce_security.group_activities%rowtype; k text;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Scheduling management required' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>20000 THEN RAISE EXCEPTION 'Invalid scheduling proposal' USING ERRCODE='22023'; END IF;
 IF p_action='create_session' THEN
  kind:=p_payload->>'p_intent'; children:=ARRAY[(p_payload->>'p_child')::uuid]; staff:=ARRAY[(p_payload->>'p_provider')::uuid];
 ELSIF p_action='create_group' THEN
  kind:='group'; SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid) INTO children FROM jsonb_array_elements_text(p_payload->'p_children');
  SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid) INTO staff FROM jsonb_array_elements_text(p_payload->'p_staff');
 ELSIF p_action='update_group' THEN
  excluded:=(p_payload->>'p_activity')::uuid; kind:='group';
  SELECT * INTO g FROM rejoyce_security.group_activities WHERE id=excluded AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled activity unavailable' USING ERRCODE='42501'; END IF;
  SELECT array_agg(child_id ORDER BY child_id) INTO children FROM rejoyce_security.group_activity_children WHERE activity_id=excluded AND organization_id=org;
  SELECT array_agg(user_id ORDER BY user_id) INTO staff FROM rejoyce_security.group_activity_staff WHERE activity_id=excluded AND organization_id=org;
  skip:=p_payload->>'p_status'='canceled' OR (g.scheduled_start=(p_payload->>'p_start')::timestamptz AND g.scheduled_end=(p_payload->>'p_end')::timestamptz AND g.status=p_payload->>'p_status');
 ELSIF p_action='update_session' THEN
  excluded:=(p_payload->>'p_session')::uuid;
  SELECT * INTO s FROM public.sessions WHERE id=excluded AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled record unavailable' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_payload->'p_changes') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid schedule changes' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_payload->'p_changes') LOOP
   IF k NOT IN ('provider_id','session_type','scheduled_start','scheduled_end','location','status','attendance_status','was_supervised') THEN RAISE EXCEPTION 'Unsupported schedule field' USING ERRCODE='22023'; END IF;
  END LOOP;
  next_s:=jsonb_populate_record(s,p_payload->'p_changes'); kind:=s.workflow_intent; children:=ARRAY[s.client_id]; staff:=ARRAY[next_s.provider_id];
  from_at:=next_s.scheduled_start; to_at:=next_s.scheduled_end;
  skip:=next_s.status IN ('canceled','client_absent','provider_absent','no_show') OR
   (s.scheduled_start IS NOT DISTINCT FROM from_at AND s.scheduled_end IS NOT DISTINCT FROM to_at AND s.provider_id IS NOT DISTINCT FROM next_s.provider_id AND s.status=next_s.status);
 ELSE RAISE EXCEPTION 'Unknown scheduling action' USING ERRCODE='22023'; END IF;
 IF p_action<>'update_session' THEN from_at:=(p_payload->>'p_start')::timestamptz;to_at:=(p_payload->>'p_end')::timestamptz; END IF;
 IF kind IS NULL OR kind NOT IN ('clinical','activity','group') OR children IS NULL OR staff IS NULL OR cardinality(children) NOT BETWEEN 1 AND 200 OR cardinality(staff) NOT BETWEEN 1 AND 30 OR array_position(children,NULL) IS NOT NULL OR array_position(staff,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose valid children and assigned staff' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(children) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=requested.id AND c.organization_id=org)) OR
 EXISTS(SELECT 1 FROM unnest(staff) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=requested.id AND u.organization_id=org)) THEN RAISE EXCEPTION 'Scheduling participants unavailable' USING ERRCODE='42501'; END IF;
 IF NOT coalesce(skip,false) AND (from_at IS NULL OR to_at IS NULL OR NOT isfinite(from_at) OR NOT isfinite(to_at) OR to_at<=from_at OR to_at-from_at>interval '24 hours') THEN RAISE EXCEPTION 'Choose valid start and end times within 24 hours' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('organization',org,'children',children,'staff',staff,'start',from_at,'end',to_at,'exclude',excluded,'kind',kind,'skip',coalesce(skip,false));
END $$;

-- Internal snapshots contain IDs/versions, but public results expose only event counts.
CREATE FUNCTION rejoyce_security.conflict_snapshot(p jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
 SELECT s.id,s.updated_at::text AS version,s.workflow_intent AS kind,s.scheduled_start AS starts,s.scheduled_end AS ends,
 s.client_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'children'))) AS child,
 s.provider_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'staff'))) AS staff
 FROM public.sessions s WHERE s.organization_id=(p->>'organization')::uuid AND s.id IS DISTINCT FROM (p->>'exclude')::uuid
 AND s.status IN ('scheduled','confirmed','in_progress','paused','completed')
 UNION ALL
 SELECT a.id,a.version::text,'group',a.scheduled_start,a.scheduled_end,
 EXISTS(SELECT 1 FROM rejoyce_security.group_activity_children c WHERE c.activity_id=a.id AND c.organization_id=a.organization_id AND c.child_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'children')))),
 EXISTS(SELECT 1 FROM rejoyce_security.group_activity_staff u WHERE u.activity_id=a.id AND u.organization_id=a.organization_id AND u.user_id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'staff'))))
 FROM rejoyce_security.group_activities a WHERE a.organization_id=(p->>'organization')::uuid AND a.id IS DISTINCT FROM (p->>'exclude')::uuid AND a.status IN ('scheduled','confirmed')
 ) SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.kind,c.id),'[]') FROM candidates c
 WHERE NOT (p->>'skip')::boolean AND (c.child OR c.staff) AND c.starts<(p->>'end')::timestamptz AND (c.ends IS NULL OR (p->>'start')::timestamptz<c.ends)
$$;
CREATE FUNCTION rejoyce_security.conflict_summary(r rejoyce_security.schedule_conflict_reviews) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('reviewId',r.id,'totalEvents',jsonb_array_length(r.snapshot),
 'staffEvents',(SELECT count(*) FROM jsonb_array_elements(r.snapshot) x WHERE (x->>'staff')::boolean),
 'childEvents',(SELECT count(*) FROM jsonb_array_elements(r.snapshot) x WHERE (x->>'child')::boolean),
 'uncertainEvents',(SELECT count(*) FROM jsonb_array_elements(r.snapshot) x WHERE x->>'ends' IS NULL),
 'expiresAt',r.created_at+interval '10 minutes')
$$;
CREATE FUNCTION rejoyce_security.schedule_conflicts(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; r rejoyce_security.schedule_conflict_reviews%rowtype;
BEGIN
 p:=rejoyce_security.conflict_proposal(p_action,p_payload);
 DELETE FROM rejoyce_security.schedule_conflict_reviews expired WHERE expired.organization_id=(p->>'organization')::uuid AND expired.actor_id=auth.uid() AND expired.created_at<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM rejoyce_security.schedule_conflict_acknowledgements a WHERE a.review_id=expired.id);
 INSERT INTO rejoyce_security.schedule_conflict_reviews(organization_id,actor_id,action,payload,snapshot)
 VALUES((p->>'organization')::uuid,auth.uid(),p_action,p_payload,rejoyce_security.conflict_snapshot(p)) RETURNING * INTO r;
 RETURN rejoyce_security.conflict_summary(r);
END $$;
CREATE FUNCTION public.schedule_conflicts(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.schedule_conflicts(p_action,p_payload) $$;

-- These reviewed entrypoints preserve the old writers, receipts, cancellation fences and triggers.
-- Older RPC/direct-table write clients are still supported; do not claim universal conflict prevention.
CREATE FUNCTION rejoyce_security.save_reviewed_schedule(p_action text,p_payload jsonb,p_review uuid,p_ack jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; org uuid; r rejoyce_security.schedule_conflict_reviews%rowtype; snapshot jsonb; summary jsonb; result jsonb;
 op uuid; existing boolean; s public.sessions%rowtype; next_s public.sessions%rowtype; changed_id uuid; reason text;
BEGIN
 p:=rejoyce_security.conflict_proposal(p_action,p_payload);org:=(p->>'organization')::uuid;
 IF NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Organization editing access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 IF p_action IN ('create_session','create_group') THEN
  op:=(p_payload->>'p_operation')::uuid;
  IF op IS NULL THEN RAISE EXCEPTION 'Save operation required' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=op) INTO existing;
 ELSE existing:=false; END IF;
 IF NOT existing THEN
  -- Rebuild after obtaining the lock so participants on an edited record are current.
  p:=rejoyce_security.conflict_proposal(p_action,p_payload);snapshot:=rejoyce_security.conflict_snapshot(p);
  SELECT * INTO r FROM rejoyce_security.schedule_conflict_reviews WHERE id=p_review AND organization_id=org AND actor_id=auth.uid();
  IF NOT FOUND OR r.action<>p_action OR r.payload IS DISTINCT FROM p_payload OR r.created_at<clock_timestamp()-interval '10 minutes' OR r.snapshot IS DISTINCT FROM snapshot THEN
   RETURN jsonb_build_object('review_required',rejoyce_security.schedule_conflicts(p_action,p_payload));
  END IF;
  summary:=rejoyce_security.conflict_summary(r);
  IF jsonb_array_length(snapshot)>0 THEN
   reason:=btrim(p_ack->>'reason');
   IF reason IS NULL OR length(reason) NOT BETWEEN 10 AND 500 OR
    ((summary->>'staffEvents')::int>0 AND (p_ack->>'staff') IS DISTINCT FROM 'true') OR
    ((summary->>'childEvents')::int>0 AND (p_ack->>'children') IS DISTINCT FROM 'true') OR
    ((summary->>'uncertainEvents')::int>0 AND (p_ack->>'uncertainty') IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Review each overlap and provide a reason of 10 to 500 characters' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF p_action='create_session' THEN
  result:=rejoyce_security.create_scheduled_context_session((p_payload->>'p_child')::uuid,(p_payload->>'p_provider')::uuid,(p_payload->>'p_start')::timestamptz,(p_payload->>'p_end')::timestamptz,p_payload->>'p_type',p_payload->>'p_location',ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'p_tags')),op,p_payload->>'p_intent');
 ELSIF p_action='create_group' THEN
  result:=rejoyce_security.create_group_activity((p_payload->>'p_class')::uuid,(p_payload->>'p_version')::int,p_payload->>'p_title',ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'p_children')),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'p_staff')),(p_payload->>'p_start')::timestamptz,(p_payload->>'p_end')::timestamptz,p_payload->>'p_type',p_payload->>'p_location',op);
 ELSIF p_action='update_group' THEN
  result:=rejoyce_security.update_group_activity((p_payload->>'p_activity')::uuid,(p_payload->>'p_version')::int,(p_payload->>'p_start')::timestamptz,(p_payload->>'p_end')::timestamptz,p_payload->>'p_location',p_payload->>'p_status');
 ELSE
  SELECT * INTO s FROM public.sessions WHERE id=(p_payload->>'p_session')::uuid AND organization_id=org FOR UPDATE;
  IF NOT FOUND OR s.updated_at IS DISTINCT FROM (p_payload->>'p_version')::timestamptz THEN RAISE EXCEPTION 'Scheduled record changed; reload before editing' USING ERRCODE='40001'; END IF;
  next_s:=jsonb_populate_record(s,p_payload->'p_changes');
  -- Direct-write lifecycle guards intentionally skip definer RPCs. Preserve their rules explicitly here.
  IF s.status IN ('completed','canceled','client_absent','provider_absent','no_show') THEN RAISE EXCEPTION 'Historical sessions are read-only' USING ERRCODE='42501'; END IF;
  IF s.started_at IS NOT NULL AND (next_s.provider_id IS DISTINCT FROM s.provider_id OR next_s.session_type IS DISTINCT FROM s.session_type OR next_s.scheduled_start IS DISTINCT FROM s.scheduled_start OR next_s.scheduled_end IS DISTINCT FROM s.scheduled_end OR next_s.status IS DISTINCT FROM s.status) THEN RAISE EXCEPTION 'Assignment and schedule are locked after service starts' USING ERRCODE='42501'; END IF;
  IF s.started_at IS NULL AND next_s.status NOT IN ('scheduled','confirmed','canceled','client_absent','provider_absent','no_show') THEN RAISE EXCEPTION 'Use provider session controls to start or finish service' USING ERRCODE='42501'; END IF;
  UPDATE public.sessions SET provider_id=next_s.provider_id,session_type=next_s.session_type,scheduled_start=next_s.scheduled_start,scheduled_end=next_s.scheduled_end,location=next_s.location,status=next_s.status,attendance_status=next_s.attendance_status,was_supervised=next_s.was_supervised WHERE id=s.id AND organization_id=org RETURNING id INTO changed_id;
  result:=jsonb_build_object('id',changed_id);
 END IF;
 IF NOT existing AND jsonb_array_length(snapshot)>0 THEN
  INSERT INTO rejoyce_security.schedule_conflict_acknowledgements(review_id,organization_id,record_id,actor_id,reason,staff_reviewed,children_reviewed,uncertainty_reviewed)
  VALUES(r.id,org,coalesce((result->>'session_id')::uuid,(result->>'id')::uuid),auth.uid(),reason,coalesce((p_ack->>'staff')::boolean,false),coalesce((p_ack->>'children')::boolean,false),coalesce((p_ack->>'uncertainty')::boolean,false));
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.save_reviewed_schedule(p_action text,p_payload jsonb,p_review uuid DEFAULT NULL,p_ack jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_reviewed_schedule(p_action,p_payload,p_review,p_ack) $$;
REVOKE ALL ON FUNCTION rejoyce_security.conflict_proposal(text,jsonb),rejoyce_security.conflict_snapshot(jsonb),rejoyce_security.conflict_summary(rejoyce_security.schedule_conflict_reviews) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.schedule_conflicts(text,jsonb),rejoyce_security.schedule_conflicts(text,jsonb),public.save_reviewed_schedule(text,jsonb,uuid,jsonb),rejoyce_security.save_reviewed_schedule(text,jsonb,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_conflicts(text,jsonb),rejoyce_security.schedule_conflicts(text,jsonb),public.save_reviewed_schedule(text,jsonb,uuid,jsonb),rejoyce_security.save_reviewed_schedule(text,jsonb,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
