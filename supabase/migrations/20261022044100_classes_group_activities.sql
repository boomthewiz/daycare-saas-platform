BEGIN;
-- Classes are reusable, branch-owned scheduling rosters, not enrollment/presence.
CREATE TABLE rejoyce_security.activity_classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 branch_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 UNIQUE(id,organization_id), FOREIGN KEY(branch_id,organization_id) REFERENCES public.organization_locations(id,organization_id)
);
CREATE UNIQUE INDEX activity_class_names ON rejoyce_security.activity_classes(organization_id,branch_id,lower(name));
CREATE TABLE rejoyce_security.activity_class_children (
 organization_id uuid NOT NULL, class_id uuid NOT NULL, child_id uuid NOT NULL, PRIMARY KEY(class_id,child_id),
 FOREIGN KEY(class_id,organization_id) REFERENCES rejoyce_security.activity_classes(id,organization_id),
 FOREIGN KEY(child_id,organization_id) REFERENCES public.clients(id,organization_id)
);
CREATE TABLE rejoyce_security.activity_class_staff (
 organization_id uuid NOT NULL, class_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY(class_id,user_id),
 FOREIGN KEY(class_id,organization_id) REFERENCES rejoyce_security.activity_classes(id,organization_id),
 FOREIGN KEY(user_id,organization_id) REFERENCES public.users(id,organization_id)
);
CREATE TABLE rejoyce_security.group_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 class_id uuid NOT NULL, branch_id uuid NOT NULL, class_name text NOT NULL, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 session_type text NOT NULL, scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL,
 location text CHECK(length(location)<=120), status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','scheduled','canceled')),
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id), FOREIGN KEY(class_id,organization_id) REFERENCES rejoyce_security.activity_classes(id,organization_id),
 FOREIGN KEY(branch_id,organization_id) REFERENCES public.organization_locations(id,organization_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES public.users(id,organization_id),
 CHECK(isfinite(scheduled_start) AND isfinite(scheduled_end) AND scheduled_end>scheduled_start AND scheduled_end-scheduled_start<=interval '24 hours')
);
CREATE INDEX group_activity_calendar ON rejoyce_security.group_activities(organization_id,scheduled_start,id);
CREATE TABLE rejoyce_security.group_activity_children (
 organization_id uuid NOT NULL, activity_id uuid NOT NULL, child_id uuid NOT NULL, name_snapshot text NOT NULL,
 PRIMARY KEY(activity_id,child_id), FOREIGN KEY(activity_id,organization_id) REFERENCES rejoyce_security.group_activities(id,organization_id),
 FOREIGN KEY(child_id,organization_id) REFERENCES public.clients(id,organization_id)
);
CREATE INDEX group_child_lookup ON rejoyce_security.group_activity_children(organization_id,child_id,activity_id);
CREATE TABLE rejoyce_security.group_activity_staff (
 organization_id uuid NOT NULL, activity_id uuid NOT NULL, user_id uuid NOT NULL, name_snapshot text NOT NULL,
 PRIMARY KEY(activity_id,user_id), FOREIGN KEY(activity_id,organization_id) REFERENCES rejoyce_security.group_activities(id,organization_id),
 FOREIGN KEY(user_id,organization_id) REFERENCES public.users(id,organization_id)
);
CREATE INDEX group_staff_lookup ON rejoyce_security.group_activity_staff(organization_id,user_id,activity_id);
CREATE TABLE rejoyce_security.activity_roster_history (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), record_id uuid NOT NULL, kind text NOT NULL,
 version integer NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), recorded_at timestamptz NOT NULL DEFAULT now(),
 snapshot jsonb NOT NULL, PRIMARY KEY(record_id,kind,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['activity_classes','activity_class_children','activity_class_staff','group_activities','group_activity_children','group_activity_staff','activity_roster_history'] LOOP
 EXECUTE format('ALTER TABLE rejoyce_security.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON rejoyce_security.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END; $$;

CREATE FUNCTION rejoyce_security.activity_class_context() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF org IS NULL OR NOT(public.can_manage_clients() OR public.can_manage_sessions()) THEN RAISE EXCEPTION 'Child or schedule management required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'canEdit',public.can_manage_clients(),'canWrite',rejoyce_security.organization_can_write(org),
 'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) ORDER BY name,id) FROM public.organization_locations WHERE organization_id=org),'[]'),
 'children',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',coalesce(nullif(c.preferred_name,''),c.first_name),'active',c.status='active','branch_ids',coalesce((SELECT jsonb_agg(location_id) FROM public.client_locations WHERE client_id=c.id AND organization_id=org),'[]')) ORDER BY c.first_name,c.id) FROM public.clients c WHERE c.organization_id=org),'[]'),
 'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(full_name,''),email),'active',status='active' AND role IN ('teacher','educator','therapist','assistant','aide','caregiver','staff')) ORDER BY full_name,id) FROM public.users WHERE organization_id=org),'[]'),
 'classes',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('child_ids',coalesce((SELECT jsonb_agg(child_id ORDER BY child_id) FROM rejoyce_security.activity_class_children WHERE class_id=c.id),'[]'),'staff_ids',coalesce((SELECT jsonb_agg(user_id ORDER BY user_id) FROM rejoyce_security.activity_class_staff WHERE class_id=c.id),'[]')) ORDER BY c.name,c.id) FROM rejoyce_security.activity_classes c WHERE c.organization_id=org),'[]'));
END; $$;

CREATE FUNCTION rejoyce_security.validate_activity_roster(p_org uuid,p_branch uuid,p_children uuid[],p_staff uuid[],p_active boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_children IS NULL OR p_staff IS NULL OR cardinality(p_children)>200 OR cardinality(p_staff)>30 OR array_position(p_children,NULL) IS NOT NULL OR array_position(p_staff,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose at most 200 children and 30 staff' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organization_locations WHERE id=p_branch AND organization_id=p_org AND (NOT p_active OR active) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Branch unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=ANY(p_children) AND organization_id=p_org FOR SHARE;
 IF EXISTS(SELECT 1 FROM unnest(p_children) selected(child_id) WHERE NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=selected.child_id AND c.organization_id=p_org AND (NOT p_active OR c.status='active') AND EXISTS(SELECT 1 FROM public.client_locations cl WHERE cl.client_id=c.id AND cl.location_id=p_branch AND cl.organization_id=p_org))) THEN RAISE EXCEPTION 'Every child must belong to this branch and be active for scheduling' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.users WHERE id=ANY(p_staff) AND organization_id=p_org FOR SHARE;
 IF EXISTS(SELECT 1 FROM unnest(p_staff) selected(user_id) WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=selected.user_id AND u.organization_id=p_org AND (NOT p_active OR u.status='active') AND u.role IN ('teacher','educator','therapist','assistant','aide','caregiver','staff'))) THEN RAISE EXCEPTION 'Current organization staff required' USING ERRCODE='42501'; END IF;
END; $$;
REVOKE ALL ON FUNCTION rejoyce_security.validate_activity_roster(uuid,uuid,uuid[],uuid[],boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.save_activity_class(p_id uuid,p_version integer,p_name text,p_branch uuid,p_children uuid[],p_staff uuid[],p_active boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; c rejoyce_security.activity_classes%rowtype; BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_clients() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Child management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_active IS NULL THEN RAISE EXCEPTION 'Class name required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 PERFORM rejoyce_security.validate_activity_roster(org,p_branch,p_children,p_staff,p_active);
 IF p_id IS NULL THEN
  INSERT INTO rejoyce_security.activity_classes(organization_id,branch_id,name,active) VALUES(org,p_branch,btrim(p_name),p_active) RETURNING * INTO c;
 ELSE
  SELECT * INTO c FROM rejoyce_security.activity_classes WHERE id=p_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class unavailable' USING ERRCODE='42501'; END IF;
  IF p_version IS NULL OR p_version<>c.version THEN RAISE EXCEPTION 'Class changed; reload before saving' USING ERRCODE='40001'; END IF;
  UPDATE rejoyce_security.activity_classes SET name=btrim(p_name),branch_id=p_branch,active=p_active,version=version+1 WHERE id=c.id RETURNING * INTO c;
  DELETE FROM rejoyce_security.activity_class_children WHERE class_id=c.id;
  DELETE FROM rejoyce_security.activity_class_staff WHERE class_id=c.id;
 END IF;
 INSERT INTO rejoyce_security.activity_class_children SELECT DISTINCT org,c.id,id FROM unnest(p_children) id;
 INSERT INTO rejoyce_security.activity_class_staff SELECT DISTINCT org,c.id,id FROM unnest(p_staff) id;
 INSERT INTO rejoyce_security.activity_roster_history VALUES(org,c.id,'class',c.version,auth.uid(),now(),to_jsonb(c)||jsonb_build_object('children',p_children,'staff',p_staff));
 RETURN jsonb_build_object('id',c.id,'version',c.version);
END; $$;

CREATE FUNCTION rejoyce_security.create_group_activity(p_class uuid,p_version integer,p_title text,p_children uuid[],p_staff uuid[],p_start timestamptz,p_end timestamptz,p_type text,p_location text,p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; c rejoyce_security.activity_classes%rowtype; payload jsonb; saved rejoyce_security.session_creation_operations%rowtype; result jsonb; aid uuid; children uuid[]; staff uuid[]; BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Schedule management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_operation IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR cardinality(p_children)<1 OR cardinality(p_staff)<1 THEN RAISE EXCEPTION 'Activity name, children, staff and operation required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO children FROM unnest(p_children) id;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO staff FROM unnest(p_staff) id;
 payload:=jsonb_build_object('intent','group_activity','class',p_class,'version',p_version,'title',p_title,'children',children,'staff',staff,'start',p_start,'end',p_end,'type',p_type,'location',p_location);
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() OR saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Operation reused with different details' USING ERRCODE='40001'; END IF;
  RETURN saved.result;
 END IF;
 IF EXISTS(SELECT 1 FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation) THEN RAISE EXCEPTION 'Save attempt canceled' USING ERRCODE='40001'; END IF;
 SELECT * INTO c FROM rejoyce_security.activity_classes WHERE id=p_class AND organization_id=org AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Class unavailable' USING ERRCODE='42501'; END IF;
 IF p_version IS NULL OR p_version<>c.version THEN RAISE EXCEPTION 'Class roster changed; reload and review children and staff' USING ERRCODE='40001'; END IF;
 IF p_children IS NULL OR p_staff IS NULL OR cardinality(p_children)>200 OR cardinality(p_staff)>30 THEN RAISE EXCEPTION 'Invalid roster size' USING ERRCODE='22023'; END IF;
 PERFORM rejoyce_security.validate_activity_roster(org,c.branch_id,p_children,p_staff,true);
 PERFORM 1 FROM public.session_types WHERE organization_id=org AND code=p_type AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active activity type required' USING ERRCODE='42501'; END IF;
 INSERT INTO rejoyce_security.group_activities(organization_id,class_id,branch_id,class_name,title,session_type,scheduled_start,scheduled_end,location,created_by)
 VALUES(org,c.id,c.branch_id,c.name,btrim(p_title),p_type,p_start,p_end,nullif(btrim(p_location),''),auth.uid()) RETURNING id INTO aid;
 INSERT INTO rejoyce_security.group_activity_children SELECT org,aid,id,coalesce(nullif(preferred_name,''),first_name) FROM public.clients WHERE id=ANY(children) AND organization_id=org;
 INSERT INTO rejoyce_security.group_activity_staff SELECT org,aid,id,coalesce(full_name,email,'Assigned staff') FROM public.users WHERE id=ANY(staff) AND organization_id=org;
 result:=jsonb_build_object('session_id',aid,'workflow_intent','activity','group_activity',true,'targets_added',0,'status','confirmed','scheduled_start',p_start,'scheduled_end',p_end);
 INSERT INTO rejoyce_security.session_creation_operations VALUES(org,p_operation,auth.uid(),payload,result);
 INSERT INTO rejoyce_security.activity_roster_history VALUES(org,aid,'activity',1,auth.uid(),now(),payload||result);
 RETURN result;
END; $$;

CREATE FUNCTION rejoyce_security.group_activity_schedule(p_activity uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; a rejoyce_security.group_activities%rowtype; BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 SELECT * INTO a FROM rejoyce_security.group_activities WHERE id=p_activity AND organization_id=org;
 IF NOT FOUND OR NOT(public.can_manage_sessions() OR EXISTS(SELECT 1 FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id AND user_id=auth.uid())) THEN RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(a)||jsonb_build_object('workflow_intent','activity','group_activity',true,'child_name',a.title,
 'children',(SELECT jsonb_agg(jsonb_build_object('id',child_id,'name',name_snapshot) ORDER BY name_snapshot,child_id) FROM rejoyce_security.group_activity_children WHERE activity_id=a.id),
 'staff',(SELECT jsonb_agg(jsonb_build_object('id',user_id,'name',name_snapshot) ORDER BY name_snapshot,user_id) FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id),
 'provider_name',(SELECT string_agg(name_snapshot,', ' ORDER BY name_snapshot,user_id) FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id));
END; $$;
-- Existing activity workspace remains the single reader for individual/group activities.
ALTER FUNCTION rejoyce_security.activity_schedule(uuid) RENAME TO individual_activity_schedule;
REVOKE ALL ON FUNCTION rejoyce_security.individual_activity_schedule(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION rejoyce_security.activity_schedule(p_session uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 IF EXISTS(SELECT 1 FROM rejoyce_security.group_activities WHERE id=p_session AND organization_id=public.current_organization_id()) THEN RETURN rejoyce_security.group_activity_schedule(p_session); END IF;
 RETURN rejoyce_security.individual_activity_schedule(p_session);
END; $$;
-- Rebind the existing invoker wrapper after renaming the original implementation.
CREATE OR REPLACE FUNCTION public.activity_schedule(p_session uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.activity_schedule(p_session) $$;

CREATE FUNCTION rejoyce_security.list_group_activities(p_from timestamptz,p_to timestamptz,p_branch uuid,p_child uuid,p_assigned boolean,p_page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; rows jsonb; BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR p_assigned IS NULL OR p_page IS NULL OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid activity request' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.scheduled_start,q.id),'[]') INTO rows FROM (
 SELECT a.id,a.title AS activity_title,a.class_name,a.branch_id,a.status,a.session_type,a.scheduled_start,a.scheduled_end,a.location,'activity'::text AS workflow_intent,true AS group_activity,
 NULL::uuid AS client_id,NULL::uuid AS provider_id,NULL::jsonb AS clients,NULL::jsonb AS session_notes,'[]'::jsonb AS session_targets,NULL::timestamptz AS completed_at,
 jsonb_build_object('full_name',(SELECT string_agg(name_snapshot,', ' ORDER BY name_snapshot,user_id) FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id)) AS provider,
 (SELECT count(*) FROM rejoyce_security.group_activity_children WHERE activity_id=a.id) AS child_count
 FROM rejoyce_security.group_activities a WHERE a.organization_id=org
 AND ((NOT p_assigned AND public.can_manage_sessions()) OR EXISTS(SELECT 1 FROM rejoyce_security.group_activity_staff WHERE activity_id=a.id AND user_id=auth.uid()))
 AND (p_from IS NULL OR a.scheduled_end>p_from) AND(p_to IS NULL OR a.scheduled_start<p_to) AND(p_branch IS NULL OR a.branch_id=p_branch)
 AND(p_child IS NULL OR EXISTS(SELECT 1 FROM rejoyce_security.group_activity_children WHERE activity_id=a.id AND child_id=p_child))
 ORDER BY a.scheduled_start,a.id LIMIT 101 OFFSET p_page*100) q;
 RETURN jsonb_build_object('rows',CASE WHEN jsonb_array_length(rows)>100 THEN rows-100 ELSE rows END,'hasMore',jsonb_array_length(rows)>100);
END; $$;

CREATE FUNCTION rejoyce_security.update_group_activity(p_activity uuid,p_version integer,p_start timestamptz,p_end timestamptz,p_location text,p_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; a rejoyce_security.group_activities%rowtype; BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Schedule management and editing access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO a FROM rejoyce_security.group_activities WHERE id=p_activity AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501'; END IF;
 IF p_version IS NULL OR p_version<>a.version OR a.status='canceled' THEN RAISE EXCEPTION 'Activity changed or canceled; reload before editing' USING ERRCODE='40001'; END IF;
 UPDATE rejoyce_security.group_activities SET scheduled_start=p_start,scheduled_end=p_end,location=nullif(btrim(p_location),''),status=p_status,version=version+1 WHERE id=a.id RETURNING * INTO a;
 INSERT INTO rejoyce_security.activity_roster_history VALUES(org,a.id,'activity',a.version,auth.uid(),now(),to_jsonb(a));
 RETURN jsonb_build_object('id',a.id,'version',a.version);
END; $$;

CREATE FUNCTION public.activity_class_context() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.activity_class_context() $$;
CREATE FUNCTION public.save_activity_class(p_id uuid,p_version integer,p_name text,p_branch uuid,p_children uuid[],p_staff uuid[],p_active boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_activity_class(p_id,p_version,p_name,p_branch,p_children,p_staff,p_active) $$;
CREATE FUNCTION public.create_group_activity(p_class uuid,p_version integer,p_title text,p_children uuid[],p_staff uuid[],p_start timestamptz,p_end timestamptz,p_type text,p_location text,p_operation uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.create_group_activity(p_class,p_version,p_title,p_children,p_staff,p_start,p_end,p_type,p_location,p_operation) $$;
CREATE FUNCTION public.list_group_activities(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_branch uuid DEFAULT NULL,p_child uuid DEFAULT NULL,p_assigned boolean DEFAULT false,p_page integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.list_group_activities(p_from,p_to,p_branch,p_child,p_assigned,p_page) $$;
CREATE FUNCTION public.update_group_activity(p_activity uuid,p_version integer,p_start timestamptz,p_end timestamptz,p_location text,p_status text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.update_group_activity(p_activity,p_version,p_start,p_end,p_location,p_status) $$;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname IN ('public','rejoyce_security') AND p.proname IN ('activity_class_context','save_activity_class','create_group_activity','activity_schedule','group_activity_schedule','list_group_activities','update_group_activity') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END; $$;

-- D3 stays invoker/RLS scoped; the additional source freshly checks both report and schedule authority.
CREATE FUNCTION rejoyce_security.report_group_activities(p_from timestamptz,p_to timestamptz,p_branch uuid,p_status text,p_search text)
RETURNS TABLE(id uuid,name text,status text,activity_type text,scheduled_start timestamptz,scheduled_end timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE caps jsonb; BEGIN
 PERFORM rejoyce_security.require_unlocked();caps:=public.effective_capabilities();
 IF NOT coalesce((caps->>'reports')::boolean,false) OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Report and schedule access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.id,a.title||' · '||a.class_name,a.status,a.session_type||' · Group activity',a.scheduled_start,a.scheduled_end
 FROM rejoyce_security.group_activities a WHERE a.organization_id=public.current_organization_id()
 AND a.scheduled_start>=p_from AND a.scheduled_start<p_to AND(p_branch IS NULL OR a.branch_id=p_branch)
 AND(p_status IS NULL OR a.status=p_status) AND strpos(lower(a.title||' '||a.class_name),lower(p_search))>0;
END; $$;
CREATE FUNCTION public.report_group_activities(p_from timestamptz,p_to timestamptz,p_branch uuid,p_status text,p_search text)
RETURNS TABLE(id uuid,name text,status text,activity_type text,scheduled_start timestamptz,scheduled_end timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM rejoyce_security.report_group_activities(p_from,p_to,p_branch,p_status,p_search) $$;
REVOKE ALL ON FUNCTION rejoyce_security.report_group_activities(timestamptz,timestamptz,uuid,text,text),public.report_group_activities(timestamptz,timestamptz,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.report_group_activities(timestamptz,timestamptz,uuid,text,text),public.report_group_activities(timestamptz,timestamptz,uuid,text,text) TO authenticated;
DO $$ DECLARE definition text; anchor text:='ORDER BY s.scheduled_start,s.id LIMIT 101 OFFSET p_page*100'; BEGIN
 definition:=pg_get_functiondef('public.operational_report(text,date,date,uuid,text,text,integer)'::regprocedure);
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'D3 source changed; reconcile group activities'; END IF;
 definition:=replace(definition,anchor,'UNION ALL SELECT * FROM public.report_group_activities(start_at,end_at,p_branch,p_status,p_search) ORDER BY scheduled_start,id LIMIT 101 OFFSET p_page*100');
 EXECUTE definition;
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
