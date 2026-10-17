BEGIN;
-- Explicit organization reporting timezone: existing tenants have no inferred default.
CREATE TABLE rejoyce_security.reporting_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  timezone text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id)
);
CREATE TABLE rejoyce_security.reporting_timezone_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
  previous_timezone text, timezone text NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rejoyce_security.reporting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.reporting_timezone_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.reporting_settings,rejoyce_security.reporting_timezone_history FROM PUBLIC,anon,authenticated;

-- Whitelisted current capabilities, not product entitlements or role inference.
-- Definer is needed only for private settings and the caller's system-admin flag.
CREATE FUNCTION rejoyce_security.effective_capabilities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; tz text;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org := public.current_organization_id();
  IF auth.uid() IS NULL OR org IS NULL THEN RAISE EXCEPTION 'Active organization account required' USING ERRCODE='42501'; END IF;
  SELECT timezone INTO tz FROM rejoyce_security.reporting_settings WHERE organization_id=org;
  RETURN jsonb_build_object('userId',auth.uid(),'organizationId',org,
    'clients',public.can_manage_clients(),'users',public.can_manage_users(),'sessions',public.can_manage_sessions(),
    'reports',public.can_access_reports(),'reviews',public.can_review_sessions() OR rejoyce_security.is_note_admin(),
    'billing',public.can_manage_billing(), 'owner',public.is_organization_owner(),
    'accessRequests',EXISTS(SELECT 1 FROM public.system_admins WHERE user_id=auth.uid() AND active),
    'canWrite',(public.subscription_access()->>'canWrite')::boolean,
    'reportingTimezone',tz,'reportingToday',CASE WHEN tz IS NOT NULL THEN (statement_timestamp() AT TIME ZONE tz)::date END);
END;
$$;
CREATE FUNCTION public.effective_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.effective_capabilities() $$;
REVOKE ALL ON FUNCTION rejoyce_security.effective_capabilities(), public.effective_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.effective_capabilities(), public.effective_capabilities() TO authenticated;

CREATE FUNCTION rejoyce_security.set_reporting_timezone(p_timezone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; previous text;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org:=public.current_organization_id();
  IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN
    RAISE EXCEPTION 'Schedule management and editing access required' USING ERRCODE='42501';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone AND (name LIKE '%/%' OR name='UTC') AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%') THEN
    RAISE EXCEPTION 'Choose a recognized IANA timezone' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
  SELECT timezone INTO previous FROM rejoyce_security.reporting_settings WHERE organization_id=org;
  IF previous IS NOT DISTINCT FROM p_timezone THEN RETURN; END IF;
  INSERT INTO rejoyce_security.reporting_settings(organization_id,timezone,updated_by) VALUES(org,p_timezone,auth.uid())
    ON CONFLICT(organization_id) DO UPDATE SET timezone=excluded.timezone,updated_by=excluded.updated_by,updated_at=statement_timestamp();
  INSERT INTO rejoyce_security.reporting_timezone_history(organization_id,previous_timezone,timezone,actor_id) VALUES(org,previous,p_timezone,auth.uid());
END;
$$;
CREATE FUNCTION public.set_reporting_timezone(p_timezone text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.set_reporting_timezone(p_timezone) $$;
REVOKE ALL ON FUNCTION rejoyce_security.set_reporting_timezone(text),public.set_reporting_timezone(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.set_reporting_timezone(text),public.set_reporting_timezone(text) TO authenticated;

-- Caller RLS still scopes all source reads. The report grant never broadens source authority.
-- Page and CSV use this same endpoint; CSV exports only the explicitly requested page.
CREATE FUNCTION public.operational_report(p_report text,p_from date DEFAULT NULL,p_to date DEFAULT NULL,
  p_branch uuid DEFAULT NULL,p_status text DEFAULT NULL,p_search text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE org uuid; caps jsonb; tz text; start_at timestamptz; end_at timestamptz; result jsonb; staff jsonb;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  caps:=public.effective_capabilities(); org:=(caps->>'organizationId')::uuid; tz:=caps->>'reportingTimezone';
  IF NOT (caps->>'reports')::boolean THEN RAISE EXCEPTION 'Report access required' USING ERRCODE='42501'; END IF;
  IF p_report NOT IN ('D1','D2','D3') OR p_report IS NULL OR p_page IS NULL OR p_page<0 OR p_page>10000
    OR p_search IS NULL OR length(p_search)>100 OR length(p_status)>50 THEN
    RAISE EXCEPTION 'Invalid report filters' USING ERRCODE='22023';
  END IF;
  IF (p_report='D1' AND NOT ((caps->>'clients')::boolean OR (caps->>'sessions')::boolean))
    OR (p_report='D2' AND NOT (caps->>'users')::boolean) OR (p_report='D3' AND NOT (caps->>'sessions')::boolean) THEN
    RAISE EXCEPTION 'Report source authority required' USING ERRCODE='42501';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_locations WHERE id=p_branch AND organization_id=org) THEN
    RAISE EXCEPTION 'Branch unavailable' USING ERRCODE='42501';
  END IF;
  IF p_report='D3' THEN
    IF tz IS NULL THEN RAISE EXCEPTION 'Set the organization reporting timezone first' USING ERRCODE='22023'; END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN
      RAISE EXCEPTION 'Choose a date range of at most 367 days' USING ERRCODE='22023';
    END IF;
    start_at:=p_from::timestamp AT TIME ZONE tz;
    end_at:=(p_to+1)::timestamp AT TIME ZONE tz;
  ELSIF p_from IS NOT NULL OR p_to IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot reports do not accept historical date filters' USING ERRCODE='22023';
  END IF;
  IF p_report='D1' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO result FROM (
      SELECT c.id,concat_ws(' ',c.first_name,c.last_name) name,c.status,
        coalesce((SELECT string_agg(l.name,', ' ORDER BY l.name,l.id) FROM public.client_locations cl
          JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=org
          WHERE cl.client_id=c.id AND cl.organization_id=org),'') current_branches
      FROM public.clients c WHERE c.organization_id=org AND (p_status IS NULL OR c.status=p_status)
        AND strpos(lower(concat_ws(' ',c.first_name,c.last_name,c.preferred_name)),lower(p_search))>0
        AND (p_branch IS NULL OR EXISTS(SELECT 1 FROM public.client_locations cl WHERE cl.organization_id=org AND cl.client_id=c.id AND cl.location_id=p_branch))
      ORDER BY c.id LIMIT 101 OFFSET p_page*100
    ) q;
  ELSIF p_report='D2' THEN
    staff:=public.onboarding_progress(true)->'staff';
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO result FROM (
      SELECT u.id,u.full_name name,u.status,u.role,r.value->>'invitation' invitation,
        (r.value->>'pin_ready')::boolean pin_ready,(r.value->>'account_ready')::boolean account_ready,
        (r.value->>'branch_assigned')::boolean branch_assigned
      FROM public.users u JOIN jsonb_array_elements(staff) r ON (r.value->>'id')::uuid=u.id
      WHERE u.organization_id=org AND (p_status IS NULL OR u.status=p_status) AND strpos(lower(coalesce(u.full_name,'')),lower(p_search))>0
        AND (p_branch IS NULL OR EXISTS(SELECT 1 FROM public.staff_locations sl WHERE sl.organization_id=org AND sl.user_id=u.id AND sl.location_id=p_branch))
      ORDER BY u.id LIMIT 101 OFFSET p_page*100
    ) q;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.scheduled_start,q.id),'[]'::jsonb) INTO result FROM (
      SELECT s.id,concat_ws(' ',c.first_name,c.last_name) name,s.status,
        coalesce((SELECT st.name FROM public.session_types st WHERE st.organization_id=org AND st.code=s.session_type LIMIT 1),s.session_type) activity_type,
        s.scheduled_start,s.scheduled_end
      FROM public.sessions s JOIN public.clients c ON c.id=s.client_id AND c.organization_id=org
      WHERE s.organization_id=org AND s.scheduled_start>=start_at AND s.scheduled_start<end_at
        AND (p_status IS NULL OR s.status=p_status) AND strpos(lower(concat_ws(' ',c.first_name,c.last_name)),lower(p_search))>0
        AND (p_branch IS NULL OR EXISTS(SELECT 1 FROM public.client_locations cl WHERE cl.organization_id=org AND cl.client_id=s.client_id AND cl.location_id=p_branch))
      ORDER BY s.scheduled_start,s.id LIMIT 101 OFFSET p_page*100
    ) q;
  END IF;
  RETURN jsonb_build_object('report',p_report,'asOf',statement_timestamp(),'timezone',tz,'from',p_from,'to',p_to,
    'page',p_page,'hasMore',jsonb_array_length(result)>100,'rows',
    (SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(result) WITH ORDINALITY WHERE ordinality<=100));
END;
$$;
REVOKE ALL ON FUNCTION public.operational_report(text,date,date,uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.operational_report(text,date,date,uuid,text,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
