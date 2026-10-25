BEGIN;
-- Private transaction-bound permits cannot be forged through client-set session variables.
CREATE TABLE rejoyce_security.schedule_write_permits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id bigint NOT NULL, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL REFERENCES public.users(id), review_id uuid NOT NULL REFERENCES rejoyce_security.schedule_conflict_reviews(id),
 proposal jsonb NOT NULL, snapshot jsonb NOT NULL, record_id uuid, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX schedule_write_permits_transaction ON rejoyce_security.schedule_write_permits(transaction_id,organization_id,actor_id);
CREATE TABLE rejoyce_security.schedule_write_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id bigint NOT NULL, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL REFERENCES public.users(id), record_id uuid NOT NULL, kind text NOT NULL, operation text NOT NULL,
 review_id uuid REFERENCES rejoyce_security.schedule_conflict_reviews(id), previous jsonb, proposal jsonb NOT NULL, snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX schedule_write_audit_record ON rejoyce_security.schedule_write_audit(organization_id,record_id,recorded_at);
CREATE TABLE rejoyce_security.schedule_group_creations (
 transaction_id bigint NOT NULL, record_id uuid PRIMARY KEY, organization_id uuid NOT NULL, actor_id uuid NOT NULL
);
ALTER TABLE rejoyce_security.schedule_group_creations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.schedule_group_creations FROM PUBLIC,anon,authenticated;
ALTER TABLE rejoyce_security.schedule_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.schedule_write_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.schedule_write_permits,rejoyce_security.schedule_write_audit FROM PUBLIC,anon,authenticated;

-- Retain the existing reviewed validation, receipts and acknowledgement transaction.
-- Insert a permit only after review validation, and close it immediately after the writer returns.
DO $$
DECLARE definition text; marker text:=E' IF p_action=''create_session'' THEN\n  result:=';
BEGIN
 SELECT pg_get_functiondef('rejoyce_security.save_reviewed_schedule_before_timezone(text,jsonb,uuid,jsonb)'::regprocedure) INTO definition;
 IF position(marker IN definition)=0 OR position('reason text;' IN definition)=0 THEN RAISE EXCEPTION 'Reviewed writer definition changed; review the coverage migration'; END IF;
 definition:=replace(definition,'reason text;','reason text; permit_id uuid;');
 definition:=replace(definition,marker,E' IF NOT existing THEN\n  INSERT INTO rejoyce_security.schedule_write_permits(transaction_id,organization_id,actor_id,review_id,proposal,snapshot) VALUES(txid_current(),org,auth.uid(),r.id,p,snapshot) RETURNING id INTO permit_id;\n END IF;\n'||marker);
 definition:=replace(definition,E' IF NOT existing AND jsonb_array_length(snapshot)>0 THEN',E' IF permit_id IS NOT NULL THEN\n  UPDATE rejoyce_security.schedule_write_permits SET record_id=coalesce((result->>''session_id'')::uuid,(result->>''id'')::uuid),active=false WHERE id=permit_id;\n END IF;\n IF NOT existing AND jsonb_array_length(snapshot)>0 THEN');
 EXECUTE definition;
END $$;

-- Reviewed clean saves are durable audit evidence too; pruning must not delete their reviews.
DO $$
DECLARE definition text; marker text:='AND NOT EXISTS(SELECT 1 FROM rejoyce_security.schedule_conflict_acknowledgements a WHERE a.review_id=expired.id)';
BEGIN
 SELECT pg_get_functiondef('rejoyce_security.schedule_conflicts_before_timezone(text,jsonb)'::regprocedure) INTO definition;
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Review pruning definition changed; review the coverage migration'; END IF;
 EXECUTE replace(definition,marker,marker||' AND NOT EXISTS(SELECT 1 FROM rejoyce_security.schedule_write_permits p WHERE p.review_id=expired.id)');
END $$;

CREATE FUNCTION rejoyce_security.require_schedule_writer(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Scheduling writes require read committed isolation and a fresh transactional review' USING ERRCODE='25000'; END IF;
 PERFORM rejoyce_security.require_unlocked();
 IF auth.uid() IS NULL OR p_org IS DISTINCT FROM public.current_organization_id() OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(p_org) THEN RAISE EXCEPTION 'Active organization scheduling and editing access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM rejoyce_security.scheduling_timezone_settings WHERE organization_id=p_org) THEN RAISE EXCEPTION 'Confirm organization scheduling timezone first' USING ERRCODE='22023'; END IF;
END $$;

CREATE FUNCTION rejoyce_security.match_schedule_permit(p jsonb,p_record uuid,p_active boolean) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT permit.review_id FROM rejoyce_security.schedule_write_permits permit
 WHERE permit.transaction_id=txid_current() AND permit.organization_id=(p->>'organization')::uuid AND permit.actor_id=auth.uid()
 AND (CASE WHEN p_active THEN permit.active ELSE permit.record_id=p_record END)
 AND permit.proposal->'children'=p->'children' AND permit.proposal->'staff'=p->'staff'
 AND permit.proposal->>'kind'=p->>'kind'
 AND (permit.proposal->>'start')::timestamptz IS NOT DISTINCT FROM (p->>'start')::timestamptz
 AND (permit.proposal->>'end')::timestamptz IS NOT DISTINCT FROM (p->>'end')::timestamptz
 AND ((permit.proposal->>'exclude') IS NULL OR (permit.proposal->>'exclude')::uuid=p_record)
 ORDER BY permit.created_at DESC LIMIT 1
$$;
CREATE FUNCTION rejoyce_security.check_schedule_write(p jsonb,p_record uuid,p_operation text,p_active boolean,p_previous jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; review uuid; permitted_snapshot jsonb;
BEGIN
 snapshot:=CASE WHEN coalesce((p->>'skip')::boolean,false) THEN '[]'::jsonb ELSE rejoyce_security.conflict_snapshot(p) END;
 review:=rejoyce_security.match_schedule_permit(p,p_record,p_active);
 IF jsonb_array_length(snapshot)>0 THEN
  SELECT s.snapshot INTO permitted_snapshot FROM rejoyce_security.schedule_write_permits s WHERE s.review_id=review AND s.transaction_id=txid_current() AND s.actor_id=auth.uid() ORDER BY s.created_at DESC LIMIT 1;
  IF review IS NULL OR permitted_snapshot IS DISTINCT FROM snapshot OR (NOT p_active AND NOT EXISTS(SELECT 1 FROM rejoyce_security.schedule_conflict_acknowledgements a WHERE a.review_id=review AND a.record_id=p_record AND a.actor_id=auth.uid())) THEN
   RAISE EXCEPTION 'Schedule overlaps require a current acknowledged review. Use the scheduling workspace.' USING ERRCODE='40001';
  END IF;
 END IF;
 INSERT INTO rejoyce_security.schedule_write_audit(transaction_id,organization_id,actor_id,record_id,kind,operation,review_id,previous,proposal,snapshot)
 VALUES(txid_current(),(p->>'organization')::uuid,auth.uid(),p_record,p->>'kind',p_operation,review,p_previous,p,snapshot);
END $$;

CREATE FUNCTION rejoyce_security.guard_schedule_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; old_occupied boolean; new_occupied boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel scheduled records through the scheduling workspace; deletion is not a supported scheduling action' USING ERRCODE='42501'; END IF;
 new_occupied:=NEW.status IN ('scheduled','confirmed','in_progress','paused','completed');
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Scheduled record identity cannot change' USING ERRCODE='42501'; END IF;
  old_occupied:=OLD.status IN ('scheduled','confirmed','in_progress','paused','completed');
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id AND new_occupied=old_occupied THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed','canceled','client_absent','provider_absent','no_show') THEN RAISE EXCEPTION 'Historical sessions are read-only' USING ERRCODE='42501'; END IF;
  IF OLD.started_at IS NOT NULL AND (NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.provider_id IS DISTINCT FROM OLD.provider_id) THEN RAISE EXCEPTION 'Assignment and schedule are locked after service starts' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM rejoyce_security.require_schedule_writer(NEW.organization_id);
 IF new_occupied AND (NEW.scheduled_start IS NULL OR NEW.scheduled_end IS NULL OR NOT isfinite(NEW.scheduled_start) OR NOT isfinite(NEW.scheduled_end) OR NEW.scheduled_end<=NEW.scheduled_start OR NEW.scheduled_end-NEW.scheduled_start>interval '24 hours') THEN RAISE EXCEPTION 'Scheduled writes require finite start and end times within 24 hours' USING ERRCODE='22023'; END IF;
 p:=jsonb_build_object('organization',NEW.organization_id,'children',ARRAY[NEW.client_id],'staff',CASE WHEN NEW.provider_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.provider_id] END,'start',NEW.scheduled_start,'end',NEW.scheduled_end,'exclude',NEW.id,'kind',NEW.workflow_intent,'skip',NOT new_occupied);
 PERFORM rejoyce_security.check_schedule_write(p,NEW.id,TG_OP,true,CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('start',OLD.scheduled_start,'end',OLD.scheduled_end,'child',OLD.client_id,'provider',OLD.provider_id,'status',OLD.status,'version',OLD.updated_at) ELSE NULL END);
 RETURN NEW;
END $$;
CREATE TRIGGER guard_schedule_write BEFORE INSERT OR UPDATE OR DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_schedule_write();

-- Group snapshots are inserted after the parent. Lock before the parent mutation, then validate
-- the final saved roster at transaction end, when the reviewed permit and acknowledgement exist.
CREATE FUNCTION rejoyce_security.lock_group_schedule_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel group activities through the scheduling workspace' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Scheduled record identity cannot change' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 PERFORM rejoyce_security.require_schedule_writer(NEW.organization_id);
 IF TG_OP='INSERT' THEN INSERT INTO rejoyce_security.schedule_group_creations VALUES(txid_current(),NEW.id,NEW.organization_id,auth.uid()); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_group_schedule_write BEFORE INSERT OR UPDATE OR DELETE ON rejoyce_security.group_activities FOR EACH ROW EXECUTE FUNCTION rejoyce_security.lock_group_schedule_write();
CREATE FUNCTION rejoyce_security.guard_saved_group_roster() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Saved participant snapshots are immutable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rejoyce_security.schedule_group_creations c WHERE c.record_id=NEW.activity_id AND c.organization_id=NEW.organization_id AND c.transaction_id=txid_current() AND c.actor_id=auth.uid()) THEN RAISE EXCEPTION 'Saved participant snapshots are immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_saved_group_roster BEFORE INSERT OR UPDATE OR DELETE ON rejoyce_security.group_activity_children FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_saved_group_roster();
CREATE TRIGGER guard_saved_group_roster BEFORE INSERT OR UPDATE OR DELETE ON rejoyce_security.group_activity_staff FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_saved_group_roster();
CREATE FUNCTION rejoyce_security.check_group_schedule_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a rejoyce_security.group_activities%rowtype; children uuid[]; staff uuid[]; p jsonb;
BEGIN
 IF TG_OP='UPDATE' AND NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end AND NEW.status=OLD.status THEN RETURN NULL; END IF;
 SELECT * INTO a FROM rejoyce_security.group_activities WHERE id=NEW.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group schedule disappeared during save' USING ERRCODE='40001'; END IF;
 PERFORM rejoyce_security.require_schedule_writer(a.organization_id);
 SELECT array_agg(child_id ORDER BY child_id) INTO children FROM rejoyce_security.group_activity_children WHERE activity_id=a.id AND organization_id=a.organization_id;
 SELECT array_agg(user_id ORDER BY user_id) INTO staff FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id AND organization_id=a.organization_id;
 IF children IS NULL OR staff IS NULL THEN RAISE EXCEPTION 'Saved group roster required' USING ERRCODE='22023'; END IF;
 p:=jsonb_build_object('organization',a.organization_id,'children',children,'staff',staff,'start',a.scheduled_start,'end',a.scheduled_end,'exclude',a.id,'kind','group','skip',a.status NOT IN ('scheduled','confirmed'));
 PERFORM rejoyce_security.check_schedule_write(p,a.id,TG_OP,false,CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('start',OLD.scheduled_start,'end',OLD.scheduled_end,'status',OLD.status,'version',OLD.version) ELSE NULL END);
 DELETE FROM rejoyce_security.schedule_group_creations WHERE record_id=a.id AND transaction_id=txid_current();
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_group_schedule_write AFTER INSERT OR UPDATE ON rejoyce_security.group_activities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rejoyce_security.check_group_schedule_write();

REVOKE ALL ON FUNCTION rejoyce_security.require_schedule_writer(uuid),rejoyce_security.match_schedule_permit(jsonb,uuid,boolean),rejoyce_security.check_schedule_write(jsonb,uuid,text,boolean,jsonb),rejoyce_security.guard_schedule_write(),rejoyce_security.lock_group_schedule_write(),rejoyce_security.check_group_schedule_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION rejoyce_security.guard_saved_group_roster() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
