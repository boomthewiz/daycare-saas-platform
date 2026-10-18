BEGIN;
ALTER TABLE public.user_permissions ADD COLUMN can_view_attendance boolean NOT NULL DEFAULT false,
  ADD COLUMN can_record_attendance boolean NOT NULL DEFAULT false, ADD COLUMN can_correct_attendance boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.has_org_permission(requested_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_org uuid;
  user_role text;
  permission_granted boolean := false;
begin
  PERFORM rejoyce_security.require_unlocked();

  select
    u.organization_id,
    u.role
  into
    user_org,
    user_role
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1;

  if user_org is null then
    return false;
  end if;

  -- Organization owner always has full organization authority.
  if user_role = 'owner' then
    return true;
  end if;

  select
    case requested_permission

      when 'view_attendance' then coalesce(p.can_view_attendance,false)
      when 'record_attendance' then coalesce(p.can_record_attendance,false)
      when 'correct_attendance' then coalesce(p.can_correct_attendance,false)
      when 'manage_users'
        then coalesce(p.can_manage_users, false)

      when 'manage_clients'
        then coalesce(p.can_manage_clients, false)

      when 'manage_sessions'
        then coalesce(p.can_manage_sessions, false)

      when 'review_sessions'
        then coalesce(p.can_review_sessions, false)

      when 'view_reports'
        then coalesce(p.can_view_reports, false)

      when 'manage_billing'
        then coalesce(p.can_manage_billing, false)

      else false
    end

  into permission_granted

  from public.user_permissions as p
  where p.user_id = auth.uid()
    and p.organization_id = user_org
  limit 1;

  return coalesce(permission_granted, false);
end;
$function$
;


CREATE FUNCTION rejoyce_security.guard_attendance_grant() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND ((TG_OP='INSERT' AND NEW.can_correct_attendance) OR (TG_OP='UPDATE' AND NEW.can_correct_attendance IS DISTINCT FROM OLD.can_correct_attendance))
 AND coalesce(public.current_user_role(),'') NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Only owner/admin may change attendance correction authority' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_attendance_grant BEFORE INSERT OR UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_attendance_grant();
REVOKE ALL ON FUNCTION rejoyce_security.guard_attendance_grant() FROM PUBLIC,anon,authenticated;

CREATE TABLE rejoyce_security.attendance_scopes (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, branch_id uuid NOT NULL,
 PRIMARY KEY(organization_id,user_id,branch_id),
 FOREIGN KEY(user_id,organization_id) REFERENCES public.users(id,organization_id),
 FOREIGN KEY(branch_id,organization_id) REFERENCES public.organization_locations(id,organization_id)
);
CREATE TABLE rejoyce_security.attendance_scope_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES public.users(id), actor_id uuid NOT NULL REFERENCES public.users(id),
 before_ids uuid[] NOT NULL, after_ids uuid[] NOT NULL, recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE rejoyce_security.attendance_visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, child_id uuid NOT NULL,
 branch_id uuid NOT NULL, branch_name text NOT NULL, timezone text NOT NULL,
 original_check_in timestamptz NOT NULL, check_in timestamptz NOT NULL, check_out timestamptz,
 opened_writable boolean NOT NULL DEFAULT true, voided boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 UNIQUE(id,organization_id), FOREIGN KEY(child_id,organization_id) REFERENCES public.clients(id,organization_id),
 FOREIGN KEY(branch_id,organization_id) REFERENCES public.organization_locations(id,organization_id),
 CHECK(check_out IS NULL OR check_out>=check_in)
);
CREATE UNIQUE INDEX attendance_one_open_visit ON rejoyce_security.attendance_visits(organization_id,child_id) WHERE check_out IS NULL AND NOT voided;
CREATE INDEX attendance_branch_day ON rejoyce_security.attendance_visits(organization_id,branch_id,check_in,id);
CREATE TABLE rejoyce_security.attendance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, visit_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), branch_id uuid NOT NULL,
 version integer NOT NULL, action text NOT NULL CHECK(action IN ('check_in','check_out','correct','void')),
 effective_in timestamptz NOT NULL, effective_out timestamptz, branch_name text NOT NULL, timezone text NOT NULL,
 reason text, recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 operation_id uuid NOT NULL, UNIQUE(visit_id,version), UNIQUE(organization_id,operation_id),
 FOREIGN KEY(visit_id,organization_id) REFERENCES rejoyce_security.attendance_visits(id,organization_id),
 FOREIGN KEY(branch_id,organization_id) REFERENCES public.organization_locations(id,organization_id)
);
CREATE TABLE rejoyce_security.attendance_operations (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), operation_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), payload jsonb NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation_id)
);
ALTER TABLE rejoyce_security.attendance_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.attendance_scope_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.attendance_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.attendance_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.attendance_scopes,rejoyce_security.attendance_scope_history,rejoyce_security.attendance_visits,rejoyce_security.attendance_events,rejoyce_security.attendance_operations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION rejoyce_security.immutable_attendance_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Attendance history is append-only'; END; $$;
CREATE TRIGGER immutable_attendance_events BEFORE UPDATE OR DELETE ON rejoyce_security.attendance_events FOR EACH ROW EXECUTE FUNCTION rejoyce_security.immutable_attendance_history();
CREATE TRIGGER immutable_attendance_scopes_history BEFORE UPDATE OR DELETE ON rejoyce_security.attendance_scope_history FOR EACH ROW EXECUTE FUNCTION rejoyce_security.immutable_attendance_history();
REVOKE ALL ON FUNCTION rejoyce_security.immutable_attendance_history() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.attendance_branch_allowed(p_branch uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT rejoyce_security.session_is_unlocked() AND public.has_org_permission('view_attendance') AND
 (public.is_organization_owner() OR EXISTS(SELECT 1 FROM rejoyce_security.attendance_scopes WHERE organization_id=public.current_organization_id() AND user_id=auth.uid() AND branch_id=p_branch))
$$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_branch_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_branch_allowed(uuid) TO authenticated;

CREATE FUNCTION rejoyce_security.attendance_context() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; branches jsonb; staff jsonb; assignments jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'active',l.active) ORDER BY l.name,l.id),'[]') INTO branches
 FROM public.organization_locations l WHERE l.organization_id=org AND (rejoyce_security.attendance_branch_allowed(l.id) OR (public.can_manage_users() AND public.current_user_role() IN ('owner','admin')));
 IF public.can_manage_users() AND public.current_user_role() IN ('owner','admin') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name) ORDER BY u.full_name,u.id),'[]') INTO staff FROM public.users u WHERE u.organization_id=org AND public.can_manage_org_user(u.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'branch_id',s.branch_id)),'[]') INTO assignments FROM rejoyce_security.attendance_scopes s WHERE s.organization_id=org;
 END IF;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'view',public.has_org_permission('view_attendance'),
 'record',public.has_org_permission('record_attendance'),'correct',public.has_org_permission('correct_attendance'),
 'reports',public.can_access_reports(),'canWrite',rejoyce_security.organization_can_write(org),
 'timezone',(SELECT timezone FROM rejoyce_security.reporting_settings WHERE organization_id=org),
 'branches',branches,'staff',coalesce(staff,'[]'),'scopes',coalesce(assignments,'[]'));
END; $$;
CREATE FUNCTION public.attendance_context() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_context() $$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_context(),public.attendance_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_context(),public.attendance_context() TO authenticated;

CREATE FUNCTION rejoyce_security.set_attendance_scope(p_user uuid,p_branches uuid[],p_expected uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; previous uuid[]; desired uuid[];
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_org_user(p_user) OR public.current_user_role() NOT IN ('owner','admin') OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Owner/admin user management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_branches IS NULL OR p_expected IS NULL OR cardinality(p_branches)>200 OR array_position(p_branches,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid branch scope' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT coalesce(array_agg(branch_id ORDER BY branch_id),'{}') INTO previous FROM rejoyce_security.attendance_scopes WHERE organization_id=org AND user_id=p_user;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO desired FROM unnest(p_branches) id;
 IF previous IS DISTINCT FROM (SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') FROM unnest(p_expected) id) THEN RAISE EXCEPTION 'Scope changed; reload before saving' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(desired) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.organization_locations l WHERE l.id=requested.id AND l.organization_id=org)) THEN RAISE EXCEPTION 'Branch unavailable' USING ERRCODE='42501'; END IF;
 DELETE FROM rejoyce_security.attendance_scopes WHERE organization_id=org AND user_id=p_user;
 INSERT INTO rejoyce_security.attendance_scopes SELECT org,p_user,id FROM unnest(desired) id;
 INSERT INTO rejoyce_security.attendance_scope_history(organization_id,user_id,actor_id,before_ids,after_ids) VALUES(org,p_user,auth.uid(),previous,desired);
END; $$;
CREATE FUNCTION public.set_attendance_scope(p_user uuid,p_branches uuid[],p_expected uuid[]) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.set_attendance_scope(p_user,p_branches,p_expected) $$;
REVOKE ALL ON FUNCTION rejoyce_security.set_attendance_scope(uuid,uuid[],uuid[]),public.set_attendance_scope(uuid,uuid[],uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.set_attendance_scope(uuid,uuid[],uuid[]),public.set_attendance_scope(uuid,uuid[],uuid[]) TO authenticated;

CREATE FUNCTION rejoyce_security.attendance_read(p_branch uuid,p_from date,p_to date,p_open boolean,p_search text,p_page integer,p_export boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; tz text; rows jsonb; children jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT rejoyce_security.attendance_branch_allowed(p_branch) OR NOT EXISTS(SELECT 1 FROM public.organization_locations WHERE id=p_branch AND organization_id=org) THEN RAISE EXCEPTION 'Attendance branch unavailable' USING ERRCODE='42501'; END IF;
 IF p_export IS NULL OR (p_export AND NOT public.can_access_reports()) THEN RAISE EXCEPTION 'Report access required' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
 IF tz IS NULL OR p_page IS NULL OR p_page<0 OR p_page>10000 OR p_open IS NULL OR p_search IS NULL OR length(p_search)>100 OR p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION 'Choose a configured timezone and valid date/page filters' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.check_in,q.id),'[]') INTO rows FROM (
  SELECT v.id,v.child_id,concat_ws(' ',c.first_name,c.last_name) name,v.branch_id,v.branch_name,v.check_in,v.check_out,v.version,v.timezone,v.voided,NULL::uuid classroom_id,
   v.check_in < (p_from::timestamp AT TIME ZONE tz) carry_in,
   v.check_out IS NULL open_visit
  FROM rejoyce_security.attendance_visits v JOIN public.clients c ON c.id=v.child_id AND c.organization_id=org
  WHERE v.organization_id=org AND v.branch_id=p_branch AND (NOT v.voided OR (NOT p_open AND NOT p_export AND public.has_org_permission('correct_attendance'))) AND strpos(lower(concat_ws(' ',c.first_name,c.last_name)),lower(p_search))>0
   AND ((p_open AND v.check_out IS NULL) OR (NOT p_open AND v.check_in < ((p_to+1)::timestamp AT TIME ZONE tz) AND (v.check_out IS NULL OR v.check_out>(p_from::timestamp AT TIME ZONE tz))))
  ORDER BY v.check_in,v.id LIMIT 101 OFFSET p_page*100
 ) q;
 -- Selectors intentionally omit notes, treatment data and other-branch open-visit details.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',concat_ws(' ',c.first_name,c.last_name)) ORDER BY c.first_name,c.id),'[]') INTO children
 FROM (SELECT c.* FROM public.clients c WHERE c.organization_id=org AND c.status='active' AND strpos(lower(concat_ws(' ',c.first_name,c.last_name)),lower(p_search))>0
 AND EXISTS(SELECT 1 FROM public.client_locations cl WHERE cl.organization_id=org AND cl.client_id=c.id AND cl.location_id=p_branch) ORDER BY c.first_name,c.id LIMIT 100) c;
 RETURN jsonb_build_object('asOf',statement_timestamp(),'timezone',tz,'page',p_page,'hasMore',jsonb_array_length(rows)>100,'children',CASE WHEN p_export THEN '[]'::jsonb ELSE children END,
 'rows',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE ordinality<=100));
END; $$;
CREATE FUNCTION public.attendance_read(p_branch uuid,p_from date,p_to date,p_open boolean DEFAULT false,p_search text DEFAULT '',p_page integer DEFAULT 0,p_export boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_read(p_branch,p_from,p_to,p_open,p_search,p_page,p_export) $$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_read(uuid,date,date,boolean,text,integer,boolean),public.attendance_read(uuid,date,date,boolean,text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_read(uuid,date,date,boolean,text,integer,boolean),public.attendance_read(uuid,date,date,boolean,text,integer,boolean) TO authenticated;

CREATE FUNCTION rejoyce_security.attendance_mutate(p_action text,p_child uuid,p_branch uuid,p_visit uuid,p_version integer,p_in timestamptz,p_out timestamptz,p_reason text,p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; v rejoyce_security.attendance_visits%rowtype; old_op rejoyce_security.attendance_operations%rowtype; child uuid; tz text; label text; payload jsonb; result jsonb; current_at timestamptz:=statement_timestamp(); can_write boolean; original_branch uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.has_org_permission('view_attendance') THEN RAISE EXCEPTION 'Attendance access required' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('check_in','check_out','correct','void') OR p_operation IS NULL THEN RAISE EXCEPTION 'Invalid attendance action' USING ERRCODE='22023'; END IF;
 IF (p_action='check_in' AND (p_visit IS NOT NULL OR p_version IS NOT NULL OR p_in IS NOT NULL OR p_out IS NOT NULL OR p_reason IS NOT NULL))
 OR (p_action='check_out' AND (p_child IS NOT NULL OR p_branch IS NOT NULL OR p_in IS NOT NULL OR p_out IS NOT NULL OR p_reason IS NOT NULL))
 OR (p_action IN ('correct','void') AND p_child IS NOT NULL)
 OR (p_action='void' AND (p_branch IS NOT NULL OR p_in IS NOT NULL OR p_out IS NOT NULL)) THEN RAISE EXCEPTION 'Unexpected fields for attendance action' USING ERRCODE='22023'; END IF;
 IF p_action IN ('check_in','check_out') AND NOT public.has_org_permission('record_attendance') OR p_action IN ('correct','void') AND NOT public.has_org_permission('correct_attendance') THEN RAISE EXCEPTION 'Attendance action authority required' USING ERRCODE='42501'; END IF;
 -- Consistent organization->child locks also serialize scope edits against a write.
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 IF p_action='check_in' THEN child:=p_child; ELSE SELECT child_id INTO child FROM rejoyce_security.attendance_visits WHERE id=p_visit AND organization_id=org; END IF;
 IF child IS NULL THEN RAISE EXCEPTION 'Attendance record unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=child AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Child unavailable' USING ERRCODE='42501'; END IF;
 IF p_action<>'check_in' THEN
  SELECT * INTO v FROM rejoyce_security.attendance_visits WHERE id=p_visit AND organization_id=org FOR UPDATE;
  IF NOT rejoyce_security.attendance_branch_allowed(v.branch_id) THEN RAISE EXCEPTION 'Attendance record unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action IN ('check_in','correct') AND NOT rejoyce_security.attendance_branch_allowed(p_branch) THEN RAISE EXCEPTION 'Attendance branch unavailable' USING ERRCODE='42501'; END IF;
 can_write:=rejoyce_security.organization_can_write(org);
 IF NOT can_write AND NOT (p_action='check_out' AND v.opened_writable AND NOT v.voided AND EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=org AND v.original_check_in < greatest(b.trial_ends_at,b.paid_through))) THEN RAISE EXCEPTION 'Editing access required; only eligible open visits may be closed' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('action',p_action,'child',p_child,'branch',p_branch,'visit',p_visit,'version',p_version,'in',p_in,'out',p_out,'reason',p_reason);
 SELECT * INTO old_op FROM rejoyce_security.attendance_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF old_op.actor_id<>auth.uid() OR old_op.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Operation ID already used with different details' USING ERRCODE='40001'; END IF;
  RETURN old_op.result;
 END IF;
 IF p_action='check_in' THEN
  SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
  SELECT name INTO label FROM public.organization_locations WHERE id=p_branch AND organization_id=org AND active;
  IF tz IS NULL OR label IS NULL OR NOT EXISTS(SELECT 1 FROM public.clients WHERE id=child AND organization_id=org AND status='active') OR NOT EXISTS(SELECT 1 FROM public.client_locations WHERE client_id=child AND organization_id=org AND location_id=p_branch) THEN RAISE EXCEPTION 'Active child membership, branch and timezone required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM rejoyce_security.attendance_visits WHERE organization_id=org AND child_id=child AND NOT voided AND check_out IS NULL) THEN RAISE EXCEPTION 'An open attendance visit already exists; ask authorized staff to review it' USING ERRCODE='40001'; END IF;
  INSERT INTO rejoyce_security.attendance_visits(organization_id,child_id,branch_id,branch_name,timezone,original_check_in,check_in) VALUES(org,child,p_branch,label,tz,current_at,current_at) RETURNING * INTO v;
 ELSE
  IF v.voided OR p_version IS NULL OR p_version<>v.version THEN RAISE EXCEPTION 'Visit changed; reload its history' USING ERRCODE='40001'; END IF;
  original_branch:=v.branch_id;
  IF p_action='check_out' THEN
   IF v.check_out IS NOT NULL THEN RAISE EXCEPTION 'Visit is already closed' USING ERRCODE='40001'; END IF;
   v.check_out:=current_at;
  ELSE
   IF p_reason IS NULL OR length(btrim(p_reason))<3 OR length(p_reason)>500 OR (v.original_check_in AT TIME ZONE v.timezone)::date < (current_at AT TIME ZONE v.timezone)::date-6 THEN RAISE EXCEPTION 'A reason and original visit within seven local dates are required' USING ERRCODE='22023'; END IF;
   IF p_action='void' THEN v.voided:=true;
   ELSE
    SELECT name INTO label FROM public.organization_locations WHERE id=p_branch AND organization_id=org;
    IF label IS NULL OR p_in IS NULL OR p_in>current_at OR p_out>current_at OR p_out<p_in OR (p_in AT TIME ZONE v.timezone)::date < (current_at AT TIME ZONE v.timezone)::date-6 THEN RAISE EXCEPTION 'Invalid corrected times or branch' USING ERRCODE='22023'; END IF;
    v.branch_id:=p_branch; v.branch_name:=label; v.check_in:=p_in; v.check_out:=p_out;
   END IF;
  END IF;
  v.version:=v.version+1;
 END IF;
 IF NOT v.voided AND EXISTS(SELECT 1 FROM rejoyce_security.attendance_visits other WHERE other.organization_id=org AND other.child_id=child AND other.id<>v.id AND NOT other.voided AND other.check_in<coalesce(v.check_out,'infinity'::timestamptz) AND coalesce(other.check_out,'infinity'::timestamptz)>v.check_in) THEN RAISE EXCEPTION 'Attendance intervals cannot overlap' USING ERRCODE='22023'; END IF;
 UPDATE rejoyce_security.attendance_visits SET branch_id=v.branch_id,branch_name=v.branch_name,check_in=v.check_in,check_out=v.check_out,voided=v.voided,version=v.version WHERE id=v.id AND organization_id=org;
 INSERT INTO rejoyce_security.attendance_events(organization_id,visit_id,actor_id,branch_id,version,action,effective_in,effective_out,branch_name,timezone,reason,operation_id) VALUES(org,v.id,auth.uid(),v.branch_id,v.version,p_action,v.check_in,v.check_out,v.branch_name,v.timezone,p_reason,p_operation);
 result:=jsonb_build_object('id',v.id,'version',v.version,'check_in',v.check_in,'check_out',v.check_out,'voided',v.voided);
 INSERT INTO rejoyce_security.attendance_operations VALUES(org,p_operation,auth.uid(),payload,result);
 RETURN result;
END; $$;
CREATE FUNCTION public.attendance_mutate(p_action text,p_child uuid DEFAULT NULL,p_branch uuid DEFAULT NULL,p_visit uuid DEFAULT NULL,p_version integer DEFAULT NULL,p_in timestamptz DEFAULT NULL,p_out timestamptz DEFAULT NULL,p_reason text DEFAULT NULL,p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_mutate(p_action,p_child,p_branch,p_visit,p_version,p_in,p_out,p_reason,p_operation) $$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_mutate(text,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,uuid),public.attendance_mutate(text,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_mutate(text,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,uuid),public.attendance_mutate(text,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,uuid) TO authenticated;

CREATE FUNCTION rejoyce_security.attendance_history(p_visit uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; result jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.has_org_permission('correct_attendance') OR NOT EXISTS(SELECT 1 FROM rejoyce_security.attendance_visits v WHERE v.id=p_visit AND v.organization_id=org AND rejoyce_security.attendance_branch_allowed(v.branch_id)) OR EXISTS(SELECT 1 FROM rejoyce_security.attendance_events WHERE visit_id=p_visit AND organization_id=org AND NOT rejoyce_security.attendance_branch_allowed(branch_id)) THEN RAISE EXCEPTION 'History unavailable for your scope' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'action',action,'check_in',effective_in,'check_out',effective_out,'branch_name',branch_name,'reason',reason,'actor_id',actor_id,'recorded_at',recorded_at) ORDER BY version),'[]') INTO result FROM rejoyce_security.attendance_events WHERE organization_id=org AND visit_id=p_visit;
 RETURN result;
END; $$;
CREATE FUNCTION public.attendance_history(p_visit uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.attendance_history(p_visit) $$;
REVOKE ALL ON FUNCTION rejoyce_security.attendance_history(uuid),public.attendance_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.attendance_history(uuid),public.attendance_history(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION rejoyce_security.effective_capabilities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; tz text;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org := public.current_organization_id();
  IF auth.uid() IS NULL OR org IS NULL THEN RAISE EXCEPTION 'Active organization account required' USING ERRCODE='42501'; END IF;
  SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
  RETURN jsonb_build_object('userId',auth.uid(),'organizationId',org,
    'attendance',public.has_org_permission('view_attendance') OR (public.can_manage_users() AND public.current_user_role() IN ('owner','admin')),'clients',public.can_manage_clients(),'users',public.can_manage_users(),'sessions',public.can_manage_sessions(),
    'reports',public.can_access_reports(),'reviews',public.can_review_sessions() OR rejoyce_security.is_note_admin(),
    'billing',public.can_manage_billing(), 'owner',public.is_organization_owner(),
    'accessRequests',EXISTS(SELECT 1 FROM public.system_admins WHERE user_id=auth.uid() AND active),
    'canWrite',(public.subscription_access()->>'canWrite')::boolean,
    'reportingTimezone',tz,'reportingToday',CASE WHEN tz IS NOT NULL THEN (statement_timestamp() AT TIME ZONE tz)::date END);
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
