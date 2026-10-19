BEGIN;
ALTER TABLE rejoyce_security.session_choices ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE FUNCTION rejoyce_security.search_session_choices(p_kind text,p_query text,p_page integer,p_archived boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; rows jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management required' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('tag','location') OR p_query IS NULL OR length(p_query)>120 OR p_page IS NULL OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid choice search' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY lower(q.label),q.id),'[]') INTO rows FROM
 (SELECT id,kind,label,domain,active,version FROM rejoyce_security.session_choices WHERE organization_id=org AND kind=p_kind AND (p_archived OR active) AND strpos(lower(label),lower(btrim(p_query)))>0 ORDER BY lower(label),id LIMIT 21 OFFSET p_page*20) q;
 RETURN jsonb_build_object('rows',CASE WHEN jsonb_array_length(rows)>20 THEN rows-20 ELSE rows END,'hasMore',jsonb_array_length(rows)>20,'page',p_page);
END; $$;
CREATE FUNCTION public.search_session_choices(p_kind text,p_query text DEFAULT '',p_page integer DEFAULT 0,p_archived boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.search_session_choices(p_kind,p_query,p_page,p_archived) $$;

CREATE FUNCTION rejoyce_security.session_context_v2(p_session uuid,p_selected uuid[],p_location text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; org uuid; choices jsonb;
BEGIN
 result:=rejoyce_security.session_context(p_session);org:=public.current_organization_id();
 IF p_selected IS NULL OR cardinality(p_selected)>40 OR array_position(p_selected,NULL) IS NOT NULL OR length(p_location)>120 THEN RAISE EXCEPTION 'Invalid selected choices' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'label',c.label,'domain',c.domain,'active',c.active,'version',c.version) ORDER BY c.label,c.id),'[]') INTO choices FROM rejoyce_security.session_choices c
 WHERE c.organization_id=org AND (c.id=ANY(p_selected) OR c.id IN (SELECT (jsonb_array_elements_text(r->'tag_ids'))::uuid FROM jsonb_array_elements(result->'recent') r) OR (c.kind='location' AND (c.label=p_location OR c.label IN (SELECT r->>'location' FROM jsonb_array_elements(result->'recent') r))));
 RETURN result||jsonb_build_object('choices',choices);
END; $$;
CREATE FUNCTION public.session_context_v2(p_session uuid DEFAULT NULL,p_selected uuid[] DEFAULT '{}',p_location text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.session_context_v2(p_session,p_selected,p_location) $$;

CREATE FUNCTION rejoyce_security.update_session_choice(p_choice uuid,p_version integer,p_action text,p_label text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; c rejoyce_security.session_choices%rowtype; new_label text;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO c FROM rejoyce_security.session_choices WHERE id=p_choice AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choice unavailable' USING ERRCODE='42501'; END IF;
 IF p_version IS NULL OR c.version<>p_version THEN RAISE EXCEPTION 'Choice changed; reload before editing' USING ERRCODE='40001'; END IF;
 IF p_action='rename' THEN
  new_label:=regexp_replace(btrim(p_label),'[[:space:]]+',' ','g');
  IF new_label IS NULL OR length(new_label) NOT BETWEEN 1 AND 120 OR p_label ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Choose a valid label' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM rejoyce_security.session_choices WHERE organization_id=org AND kind=c.kind AND lower(session_choices.label)=lower(new_label) AND id<>c.id) THEN RAISE EXCEPTION 'Duplicate label, including archived choices. Review the existing choice.' USING ERRCODE='40001'; END IF;
  UPDATE rejoyce_security.session_choices SET label=new_label,version=version+1 WHERE id=c.id;
 ELSIF p_action IN ('archive','restore') THEN UPDATE rejoyce_security.session_choices SET active=(p_action='restore'),version=version+1 WHERE id=c.id;
 ELSE RAISE EXCEPTION 'Unknown choice action' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('id',c.id);
END; $$;
CREATE FUNCTION public.update_session_choice(p_choice uuid,p_version integer,p_action text,p_label text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.update_session_choice(p_choice,p_version,p_action,p_label) $$;

-- A canceled opaque operation cannot later commit through a delayed request.
CREATE TABLE rejoyce_security.canceled_session_operations(organization_id uuid NOT NULL REFERENCES public.organizations(id),operation_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.users(id),PRIMARY KEY(organization_id,operation_id));
ALTER TABLE rejoyce_security.canceled_session_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.canceled_session_operations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION rejoyce_security.recover_session_creation(p_operation uuid,p_cancel boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; saved rejoyce_security.session_creation_operations%rowtype; actor uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() OR p_operation IS NULL OR p_cancel IS NULL THEN RAISE EXCEPTION 'Session management and operation required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('state','committed','session_id',saved.result->>'session_id');
 END IF;
 SELECT actor_id INTO actor FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF actor<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('state','canceled');
 END IF;
 IF p_cancel THEN
  IF NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Editing access required' USING ERRCODE='42501'; END IF;
  INSERT INTO rejoyce_security.canceled_session_operations VALUES(org,p_operation,auth.uid());
  RETURN jsonb_build_object('state','canceled');
 END IF;
 RETURN jsonb_build_object('state','unconfirmed');
END; $$;
CREATE FUNCTION public.recover_session_creation(p_operation uuid,p_cancel boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.recover_session_creation(p_operation,p_cancel) $$;

-- Patch both context creation paths so old tabs also honor cancellation tombstones.
DO $$ DECLARE f regprocedure; definition text; BEGIN
 FOREACH f IN ARRAY ARRAY['rejoyce_security.create_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid)'::regprocedure,'rejoyce_security.create_scheduled_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid,text)'::regprocedure] LOOP
 definition:=pg_get_functiondef(f);
 definition:=replace(definition,'payload:=jsonb_build_object(', E'IF EXISTS(SELECT 1 FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation) THEN RAISE EXCEPTION ''Save attempt canceled; start a new operation'' USING ERRCODE=''40001''; END IF;\n payload:=jsonb_build_object(');
 EXECUTE definition;
 END LOOP;
END; $$;

-- Preserve the original unique identity across archived and active choices.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('rejoyce_security.save_session_choice(text,text,text)'::regprocedure);
 definition:=replace(definition,'INSERT INTO rejoyce_security.session_choices', E'IF EXISTS(SELECT 1 FROM rejoyce_security.session_choices WHERE organization_id=org AND kind=p_kind AND lower(session_choices.label)=lower(normalized_label) AND NOT active) THEN RAISE EXCEPTION ''This label is archived. Review and explicitly restore the existing choice.'' USING ERRCODE=''40001''; END IF;\n INSERT INTO rejoyce_security.session_choices');
 EXECUTE definition;
END; $$;

CREATE FUNCTION rejoyce_security.local_time_candidates(p_local timestamp,p_timezone text) RETURNS timestamptz[] LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(candidate ORDER BY candidate),'{}') FROM (
 SELECT DISTINCT (p_local-((probe AT TIME ZONE p_timezone)-(probe AT TIME ZONE 'UTC'))) AT TIME ZONE 'UTC' candidate
 FROM generate_series((p_local AT TIME ZONE 'UTC')-interval '2 days',(p_local AT TIME ZONE 'UTC')+interval '2 days',interval '1 hour') probe
 ) q WHERE candidate AT TIME ZONE p_timezone=p_local
$$;
REVOKE ALL ON FUNCTION rejoyce_security.local_time_candidates(timestamp,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION rejoyce_security.attendance_local_options(p_visit uuid,p_local timestamp) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 PERFORM rejoyce_security.attendance_history(p_visit);
 SELECT timezone INTO tz FROM rejoyce_security.attendance_visits WHERE id=p_visit AND organization_id=public.current_organization_id();
 IF p_local IS NULL OR NOT isfinite(p_local) THEN RAISE EXCEPTION 'Choose a finite local time' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('timezone',tz,'instants',rejoyce_security.local_time_candidates(p_local,tz));
END; $$;
CREATE FUNCTION public.attendance_local_options(p_visit uuid,p_local timestamp) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_local_options(p_visit,p_local) $$;
CREATE FUNCTION rejoyce_security.correct_attendance_local(p_visit uuid,p_version integer,p_branch uuid,p_in_local timestamp,p_out_local timestamp,p_in_instant timestamptz,p_out_instant timestamptz,p_reason text,p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; b jsonb;
BEGIN
 a:=rejoyce_security.attendance_local_options(p_visit,p_in_local);
 IF p_in_instant IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(a->'instants') x WHERE x::timestamptz=p_in_instant) THEN RAISE EXCEPTION 'Choose a valid check-in occurrence; nonexistent local times are rejected' USING ERRCODE='22023'; END IF;
 IF p_out_local IS NOT NULL THEN
  b:=rejoyce_security.attendance_local_options(p_visit,p_out_local);
  IF p_out_instant IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(b->'instants') x WHERE x::timestamptz=p_out_instant) THEN RAISE EXCEPTION 'Choose a valid checkout occurrence' USING ERRCODE='22023'; END IF;
 ELSIF p_out_instant IS NOT NULL THEN RAISE EXCEPTION 'Checkout local time required' USING ERRCODE='22023'; END IF;
 RETURN rejoyce_security.attendance_mutate('correct',NULL,p_branch,p_visit,p_version,p_in_instant,p_out_instant,p_reason,p_operation);
END; $$;
CREATE FUNCTION public.correct_attendance_local(p_visit uuid,p_version integer,p_branch uuid,p_in_local timestamp,p_out_local timestamp,p_in_instant timestamptz,p_out_instant timestamptz,p_reason text,p_operation uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.correct_attendance_local(p_visit,p_version,p_branch,p_in_local,p_out_local,p_in_instant,p_out_instant,p_reason,p_operation) $$;

-- Canonical optional client linkage is explicit; legacy references are preserved, never guessed.
ALTER TABLE public.tasks ADD COLUMN client_id uuid;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_current_client_fk FOREIGN KEY(client_id,organization_id) REFERENCES public.clients(id,organization_id);
CREATE INDEX tasks_current_client_idx ON public.tasks(client_id,organization_id);
CREATE POLICY current_task_owner ON public.tasks AS RESTRICTIVE FOR ALL TO authenticated
 USING(organization_id=public.current_organization_id() AND (teacher_id=auth.uid() OR public.can_manage_clients() OR public.can_manage_sessions()))
 WITH CHECK(organization_id=public.current_organization_id() AND (teacher_id=auth.uid() OR public.can_manage_clients() OR public.can_manage_sessions()) AND (client_id IS NULL OR public.can_access_client(client_id)));
CREATE FUNCTION rejoyce_security.guard_task_owner() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND NOT (public.can_manage_clients() OR public.can_manage_sessions()) THEN
  IF TG_OP='INSERT' OR ROW(NEW.teacher_id,NEW.client_id,NEW.child_id,NEW.classroom_id,NEW.title,NEW.description,NEW.due_at,NEW.generated_date,NEW.task_type,NEW.template_id,NEW.due_time) IS DISTINCT FROM ROW(OLD.teacher_id,OLD.client_id,OLD.child_id,OLD.classroom_id,OLD.title,OLD.description,OLD.due_at,OLD.generated_date,OLD.task_type,OLD.template_id,OLD.due_time) THEN RAISE EXCEPTION 'Only authorized task managers may change ownership or task details' USING ERRCODE='42501'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER guard_task_owner BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_task_owner();
REVOKE ALL ON FUNCTION rejoyce_security.guard_task_owner() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION rejoyce_security.task_workspace(p_date date,p_page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; tz text; day date; rows jsonb; manager boolean;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
 IF tz IS NULL THEN RAISE EXCEPTION 'Configure the organization reporting timezone before loading tasks' USING ERRCODE='22023'; END IF;
 IF p_page IS NULL OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid task page' USING ERRCODE='22023'; END IF;
 day:=coalesce(p_date,(statement_timestamp() AT TIME ZONE tz)::date);manager:=public.can_manage_clients() OR public.can_manage_sessions();
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id),'[]') INTO rows FROM (
  SELECT t.id,t.title,t.description,coalesce(t.completed,false) completed,t.due_at,t.generated_date,t.created_at,
   CASE WHEN t.client_id IS NOT NULL AND public.can_access_client(t.client_id) THEN (SELECT coalesce(nullif(c.preferred_name,''),c.first_name) FROM public.clients c WHERE c.id=t.client_id AND c.organization_id=org) END client_name,
   t.child_id IS NOT NULL OR t.classroom_id IS NOT NULL legacy_reference,t.due_at IS NULL legacy_date_only
  FROM public.tasks t WHERE t.organization_id=org AND (manager OR t.teacher_id=auth.uid())
   AND ((t.due_at IS NOT NULL AND t.due_at>=day::timestamp AT TIME ZONE tz AND t.due_at<(day+1)::timestamp AT TIME ZONE tz) OR (t.due_at IS NULL AND t.generated_date=day))
  ORDER BY t.created_at DESC,t.id LIMIT 51 OFFSET p_page*50
 ) q;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'date',day,'timezone',tz,'manager',manager,'canWrite',rejoyce_security.organization_can_write(org),'rows',CASE WHEN jsonb_array_length(rows)>50 THEN rows-50 ELSE rows END,'hasMore',jsonb_array_length(rows)>50);
END; $$;
CREATE FUNCTION public.task_workspace(p_date date DEFAULT NULL,p_page integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.task_workspace(p_date,p_page) $$;
CREATE FUNCTION rejoyce_security.set_task_completed(p_task uuid,p_expected boolean,p_completed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; t public.tasks%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Editing access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR NOT (coalesce(t.teacher_id=auth.uid(),false) OR public.can_manage_clients() OR public.can_manage_sessions()) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501'; END IF;
 IF p_expected IS NULL OR p_completed IS NULL OR coalesce(t.completed,false)<>p_expected THEN RAISE EXCEPTION 'Task changed; reload before updating' USING ERRCODE='40001'; END IF;
 UPDATE public.tasks SET completed=p_completed WHERE id=t.id AND organization_id=org;
END; $$;
CREATE FUNCTION public.set_task_completed(p_task uuid,p_expected boolean,p_completed boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.set_task_completed(p_task,p_expected,p_completed) $$;

DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','rejoyce_security') AND p.proname IN ('search_session_choices','session_context_v2','update_session_choice','recover_session_creation','attendance_local_options','correct_attendance_local','task_workspace','set_task_completed') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
