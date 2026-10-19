BEGIN;
-- The default preserves existing clinical semantics without inferring intent from child labels.
ALTER TABLE public.sessions ADD COLUMN workflow_intent text NOT NULL DEFAULT 'clinical' CHECK(workflow_intent IN ('activity','clinical'));
ALTER TABLE rejoyce_security.session_recent_choices ADD COLUMN workflow_intent text NOT NULL DEFAULT 'clinical' CHECK(workflow_intent IN ('activity','clinical'));
COMMENT ON COLUMN public.sessions.workflow_intent IS 'Immutable scheduling intent; not an entitlement, attendance event, or clinical authority.';

CREATE FUNCTION rejoyce_security.guard_scheduling_intent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.workflow_intent IS DISTINCT FROM OLD.workflow_intent THEN RAISE EXCEPTION 'Scheduling intent cannot be changed' USING ERRCODE='42501'; END IF;
 IF NEW.workflow_intent='activity' AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.paused_at IS NOT NULL OR NEW.prepared_at IS NOT NULL OR NEW.prepared_by IS NOT NULL OR NEW.was_supervised OR NEW.total_paused_seconds<>0 OR NEW.status IN ('in_progress','paused','completed') OR NEW.attendance_status<>'unconfirmed') THEN RAISE EXCEPTION 'Ordinary activities do not use clinical service or attendance controls' USING ERRCODE='42501'; END IF;
 IF NEW.workflow_intent='activity' THEN
  IF NEW.scheduled_start IS NULL OR NEW.scheduled_end IS NULL OR NEW.scheduled_end<=NEW.scheduled_start OR NEW.scheduled_end-NEW.scheduled_start>interval '24 hours' OR length(NEW.location)>120 THEN RAISE EXCEPTION 'Choose valid activity times within 24 hours and a location of at most 120 characters' USING ERRCODE='22023'; END IF;
  IF TG_OP='INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.provider_id IS DISTINCT FROM OLD.provider_id OR NEW.session_type IS DISTINCT FROM OLD.session_type THEN
   IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=NEW.client_id AND organization_id=NEW.organization_id AND status='active') OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.provider_id AND organization_id=NEW.organization_id AND status='active') OR NOT EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=NEW.organization_id AND code=NEW.session_type AND active) THEN RAISE EXCEPTION 'Current child, staff and activity type required' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_scheduling_intent BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_scheduling_intent();
REVOKE ALL ON FUNCTION rejoyce_security.guard_scheduling_intent() FROM PUBLIC,anon,authenticated;

-- Applies to direct writes AND definer RPCs, including legacy clinical APIs.
CREATE FUNCTION rejoyce_security.guard_clinical_session_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 sid:=CASE WHEN TG_OP='DELETE' THEN OLD.session_id ELSE NEW.session_id END;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE id=sid AND workflow_intent='activity') THEN RAISE EXCEPTION 'Clinical records require a clinical session' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN RAISE EXCEPTION 'Clinical records cannot move between sessions' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION rejoyce_security.guard_clinical_session_record() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['session_targets','target_responses','behavior_events','session_notes','session_note_history','session_note_remarks'] LOOP
 EXECUTE format('CREATE TRIGGER guard_clinical_intent BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_session_record()',t);
 END LOOP;
END; $$;
CREATE FUNCTION rejoyce_security.create_scheduled_context_session(p_child uuid,p_provider uuid,p_start timestamptz,p_end timestamptz,p_type text,p_location text,p_tags uuid[],p_operation uuid,p_intent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; payload jsonb; saved rejoyce_security.session_creation_operations%rowtype; result jsonb; tag_ids uuid[]; duration integer; created_id uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_intent IS NULL OR p_intent NOT IN ('activity','clinical') THEN RAISE EXCEPTION 'Choose activity or clinical intent' USING ERRCODE='22023'; END IF;
 IF p_operation IS NULL OR p_tags IS NULL OR cardinality(p_tags)>20 OR array_position(p_tags,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose at most 20 valid tags and an operation ID' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO tag_ids FROM unnest(p_tags) id;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 payload:=jsonb_build_object('child',p_child,'provider',p_provider,'start',p_start,'end',p_end,'type',p_type,'location',p_location,'tags',tag_ids);
 IF p_intent='activity' THEN payload:=payload||jsonb_build_object('intent',p_intent); END IF;
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() OR saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Operation ID reused with different details' USING ERRCODE='40001'; END IF;
  RETURN saved.result;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(tag_ids) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices c WHERE c.id=requested.id AND c.organization_id=org AND c.active AND c.kind='tag')) THEN RAISE EXCEPTION 'Tag unavailable; reload choices' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '24 hours' THEN RAISE EXCEPTION 'Choose valid session times within 24 hours' USING ERRCODE='22023'; END IF;
 IF length(p_location)>120 THEN RAISE EXCEPTION 'Location is too long' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND code=p_type AND active) THEN RAISE EXCEPTION 'Activity type unavailable; reload choices' USING ERRCODE='42501'; END IF;
 IF p_intent='clinical' THEN
  result:=public.create_prepared_session(p_child,p_provider,p_start,p_end,p_type,p_location);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_child AND organization_id=org AND status='active') OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_provider AND organization_id=org AND status='active') THEN RAISE EXCEPTION 'Current child and assigned staff required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.sessions(organization_id,client_id,provider_id,session_type,workflow_intent,status,attendance_status,scheduled_start,scheduled_end,location)
  VALUES(org,p_child,p_provider,p_type,'activity','confirmed','unconfirmed',p_start,p_end,nullif(btrim(p_location),'')) RETURNING id INTO created_id;
  result:=jsonb_build_object('session_id',created_id,'client_id',p_child,'provider_id',p_provider,'scheduled_start',p_start,'scheduled_end',p_end,'status','confirmed','targets_added',0,'workflow_intent','activity');
 END IF;
 INSERT INTO rejoyce_security.session_tags(organization_id,session_id,choice_id,label_snapshot,domain_snapshot)
 SELECT org,(result->>'session_id')::uuid,id,label,domain FROM rejoyce_security.session_choices WHERE id=ANY(tag_ids) AND organization_id=org;
 duration:=greatest(1,ceil(extract(epoch FROM (p_end-p_start))/60)::integer);
 INSERT INTO rejoyce_security.session_recent_choices(organization_id,user_id,child_id,provider_id,session_type,location,tag_ids,duration_minutes,workflow_intent) VALUES(org,auth.uid(),p_child,p_provider,p_type,p_location,tag_ids,duration,p_intent);
 DELETE FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() AND id NOT IN(SELECT id FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() ORDER BY used_at DESC,id LIMIT 10);
 INSERT INTO rejoyce_security.session_creation_operations VALUES(org,p_operation,auth.uid(),payload,result);
 RETURN result;
END; $$;

CREATE FUNCTION public.create_scheduled_context_session(p_child uuid,p_provider uuid,p_start timestamptz,p_end timestamptz,p_type text,p_location text,p_tags uuid[],p_operation uuid,p_intent text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.create_scheduled_context_session(p_child,p_provider,p_start,p_end,p_type,p_location,p_tags,p_operation,p_intent) $$;
REVOKE ALL ON FUNCTION rejoyce_security.create_scheduled_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid,text),public.create_scheduled_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.create_scheduled_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid,text),public.create_scheduled_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION rejoyce_security.session_context(p_session uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; choices jsonb; recent jsonb; tags jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management required' USING ERRCODE='42501'; END IF;
 IF p_session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sessions WHERE id=p_session AND organization_id=org) THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.label,q.id),'[]') INTO choices FROM (SELECT id,kind,label,domain,active FROM rejoyce_security.session_choices WHERE organization_id=org AND active ORDER BY label,id LIMIT 500) q;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.used_at DESC,q.id),'[]') INTO recent FROM (
  SELECT r.id,r.child_id,r.provider_id,r.session_type,r.location,r.tag_ids,r.duration_minutes,r.workflow_intent,r.used_at
  FROM rejoyce_security.session_recent_choices r
  WHERE r.organization_id=org AND r.user_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.clients WHERE id=r.child_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.users WHERE id=r.provider_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND code=r.session_type AND active)
  AND NOT EXISTS(SELECT 1 FROM unnest(r.tag_ids) tag WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices WHERE id=tag AND organization_id=org AND active AND kind='tag'))
  ORDER BY r.used_at DESC,r.id LIMIT 10
 ) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',choice_id,'label',label_snapshot,'domain',domain_snapshot) ORDER BY label_snapshot,choice_id),'[]') INTO tags FROM rejoyce_security.session_tags WHERE organization_id=org AND session_id=p_session;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'choices',choices,'recent',recent,'tags',tags);
END; $$;
CREATE OR REPLACE FUNCTION public.is_assigned_to_client(requested_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    join public.users as u
      on u.id = (select auth.uid())
    where s.workflow_intent = 'clinical'
      and s.client_id = requested_client_id
      and s.provider_id = u.id
      and s.organization_id = u.organization_id
      and u.status = 'active'
      and s.status in (
        'scheduled',
        'confirmed',
        'in_progress',
        'paused',
        'completed'
      )
  )) ELSE false END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_assigned_to_session(requested_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    join public.users as u
      on u.id = (select auth.uid())
    where s.workflow_intent = 'clinical'
      and s.id = requested_session_id
      and s.provider_id = u.id
      and s.organization_id = u.organization_id
      and u.status = 'active'
  )) ELSE false END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_assigned_session_provider(requested_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    where s.workflow_intent = 'clinical'
      and s.id = requested_session_id
      and s.provider_id = auth.uid()
      and s.organization_id =
        public.current_organization_id()
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_client(requested_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id=requested_client_id
      AND c.organization_id=public.current_organization_id()
      AND (public.can_manage_clients() OR public.can_manage_sessions()
        OR rejoyce_security.is_care_member(c.id)
        OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.client_id=c.id AND s.provider_id=auth.uid() AND s.workflow_intent='clinical'))
  ) ELSE false END;
$fn$;

-- Configuration-only readiness. No attendance visit/history tables are read here.
CREATE FUNCTION rejoyce_security.attendance_activation(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; selected public.users%rowtype; admin boolean; tz text; writable boolean; branches jsonb; staff jsonb; v boolean; r boolean; c boolean; eligible boolean; owner_ready boolean;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 admin:=public.can_manage_users() AND public.current_user_role() IN ('owner','admin');
 IF auth.uid() IS NULL OR org IS NULL OR NOT (admin OR public.has_org_permission('view_attendance') OR public.has_org_permission('record_attendance') OR public.has_org_permission('correct_attendance')) THEN RAISE EXCEPTION 'Attendance configuration access required' USING ERRCODE='42501'; END IF;
 p_user:=coalesce(p_user,auth.uid());
 IF p_user<>auth.uid() AND (NOT admin OR NOT public.can_manage_org_user(p_user)) THEN RAISE EXCEPTION 'Staff readiness unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO selected FROM public.users WHERE id=p_user AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
 writable:=rejoyce_security.organization_can_write(org);
 SELECT selected.role='owner' OR coalesce(p.can_view_attendance,false),selected.role='owner' OR coalesce(p.can_record_attendance,false),selected.role='owner' OR coalesce(p.can_correct_attendance,false)
 INTO v,r,c FROM (SELECT 1) seed LEFT JOIN public.user_permissions p ON p.user_id=p_user AND p.organization_id=org;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'active',l.active,
 'assigned',selected.role='owner' OR EXISTS(SELECT 1 FROM rejoyce_security.attendance_scopes s WHERE s.organization_id=org AND s.user_id=p_user AND s.branch_id=l.id),
 'hasChild',EXISTS(SELECT 1 FROM public.client_locations cl JOIN public.clients child ON child.id=cl.client_id AND child.organization_id=org AND child.status='active' WHERE cl.organization_id=org AND cl.location_id=l.id)) ORDER BY l.name,l.id),'[]') INTO branches
 FROM public.organization_locations l WHERE l.organization_id=org AND (admin OR selected.role='owner' OR EXISTS(SELECT 1 FROM rejoyce_security.attendance_scopes s WHERE s.organization_id=org AND s.user_id=p_user AND s.branch_id=l.id));
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(branches) b WHERE (b->>'active')::boolean AND (b->>'assigned')::boolean AND (b->>'hasChild')::boolean) INTO eligible;
 IF admin THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name) ORDER BY u.full_name,u.id),'[]') INTO staff FROM public.users u WHERE u.organization_id=org AND public.can_manage_org_user(u.id);
 owner_ready:=tz IS NOT NULL AND writable AND EXISTS(SELECT 1 FROM public.users WHERE organization_id=org AND role='owner' AND status='active') AND EXISTS(SELECT 1 FROM public.organization_locations l JOIN public.client_locations cl ON cl.location_id=l.id AND cl.organization_id=org JOIN public.clients child ON child.id=cl.client_id AND child.organization_id=org AND child.status='active' WHERE l.organization_id=org AND l.active);
 END IF;
 RETURN jsonb_build_object('organizationId',org,'actorId',auth.uid(),'userId',p_user,'name',selected.full_name,'owner',selected.role='owner','active',selected.status='active','admin',admin,
 'timezone',tz,'canWrite',writable,'view',v,'record',r,'correct',c,'branches',branches,'staff',coalesce(staff,'[]'),'ownerReady',owner_ready,
 'canSetTimezone',public.can_manage_sessions(),'canManageClients',public.can_manage_clients(),'canManageBranches',public.can_manage_clients() OR public.can_manage_sessions(),
 'ready',selected.status='active' AND tz IS NOT NULL AND writable AND v AND r AND eligible);
END; $$;
CREATE FUNCTION public.attendance_activation(p_user uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_activation(p_user) $$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_activation(uuid),public.attendance_activation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_activation(uuid),public.attendance_activation(uuid) TO authenticated;
CREATE FUNCTION rejoyce_security.activity_schedule(p_session uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sessions%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT * INTO s FROM public.sessions WHERE id=p_session AND organization_id=public.current_organization_id() AND workflow_intent='activity';
 IF NOT FOUND OR NOT (public.can_manage_sessions() OR s.provider_id=auth.uid()) THEN RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',s.id,'updated_at',s.updated_at,'workflow_intent',s.workflow_intent,'session_type',s.session_type,'scheduled_start',s.scheduled_start,'scheduled_end',s.scheduled_end,'status',s.status,'location',s.location,'child_name',(SELECT coalesce(nullif(preferred_name,''),first_name) FROM public.clients WHERE id=s.client_id AND organization_id=s.organization_id),'provider_name',(SELECT full_name FROM public.users WHERE id=s.provider_id AND organization_id=s.organization_id));
END; $$;
CREATE FUNCTION public.activity_schedule(p_session uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.activity_schedule(p_session) $$;
REVOKE ALL ON FUNCTION rejoyce_security.activity_schedule(uuid),public.activity_schedule(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.activity_schedule(uuid),public.activity_schedule(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
