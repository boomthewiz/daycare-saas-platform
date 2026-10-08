BEGIN;
-- Private definer is necessary for tenant-wide booleans and auth acceptance.
-- No auth records, PIN material, email addresses or invitation tokens leave it.
CREATE FUNCTION rejoyce_security.onboarding_progress(p_include_staff boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; result jsonb; staff_summary jsonb;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org := public.current_organization_id();
  IF auth.uid() IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'An active organization account is required' USING ERRCODE='42501';
  END IF;
  IF p_include_staff AND NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'User management permission required' USING ERRCODE='42501';
  END IF;
  WITH staff AS (
    SELECT u.id,u.status,u.role,
      CASE WHEN a.email_confirmed_at IS NOT NULL THEN 'accepted'
        WHEN a.invited_at IS NOT NULL THEN 'pending' ELSE 'unknown' END invitation,
      (a.email_confirmed_at IS NOT NULL AND u.pin_hash IS NOT NULL AND coalesce(u.pin_reset_required,true)=false
        AND (a.banned_until IS NULL OR a.banned_until <= now())) account_ready,
      u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff') frontline,
      EXISTS(SELECT 1 FROM public.staff_locations sl JOIN public.organization_locations l
        ON l.id=sl.location_id AND l.organization_id=sl.organization_id
        WHERE sl.user_id=u.id AND sl.organization_id=org AND l.active) branch_assigned,
      EXISTS(SELECT 1 FROM public.client_care_members m JOIN public.clients c
        ON c.id=m.client_id AND c.organization_id=m.organization_id
        JOIN public.client_locations cl ON cl.client_id=c.id AND cl.organization_id=c.organization_id
        JOIN public.staff_locations sl ON sl.user_id=m.user_id AND sl.location_id=cl.location_id AND sl.organization_id=org
        JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=org
        WHERE m.user_id=u.id AND m.organization_id=org AND c.status='active' AND l.active) care_assigned
    FROM public.users u LEFT JOIN auth.users a ON a.id=u.id WHERE u.organization_id=org
  )
  SELECT jsonb_build_object(
    'staff_ready',EXISTS(SELECT 1 FROM staff WHERE frontline AND status='active' AND account_ready),
    'staff',CASE WHEN p_include_staff THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'invitation',invitation,'account_ready',account_ready,
      'ready',frontline AND status='active' AND account_ready,
      'frontline',frontline,'branch_assigned',branch_assigned,'care_assigned',care_assigned
    ) ORDER BY id) FROM staff),'[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO staff_summary;
  result := jsonb_build_object(
    'branch',EXISTS(SELECT 1 FROM public.organization_locations WHERE organization_id=org AND active),
    'session_type',EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND active),
    'client',EXISTS(SELECT 1 FROM public.clients WHERE organization_id=org AND status='active'),
    'staff_ready',staff_summary->'staff_ready',
    'scheduled',EXISTS(SELECT 1 FROM public.sessions WHERE organization_id=org AND scheduled_start IS NOT NULL AND status <> 'cancelled'),
    'can_write',(public.subscription_access()->>'canWrite')::boolean,
    'can_clients',public.can_manage_clients(),'can_users',public.can_manage_users(),'can_sessions',public.can_manage_sessions(),
    'staff',staff_summary->'staff'
  );
  -- Care is an optional shortcut; report it even when individual staff are hidden.
  RETURN result || jsonb_build_object('care',EXISTS(
    SELECT 1 FROM public.client_care_members m JOIN public.clients c ON c.id=m.client_id AND c.organization_id=m.organization_id
    JOIN public.users u ON u.id=m.user_id AND u.organization_id=m.organization_id
    JOIN public.client_locations cl ON cl.client_id=c.id AND cl.organization_id=org
    JOIN public.staff_locations sl ON sl.user_id=u.id AND sl.location_id=cl.location_id AND sl.organization_id=org
    JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=org
    WHERE m.organization_id=org AND c.status='active' AND u.status='active' AND l.active
      AND u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff')));
END;
$fn$;
CREATE FUNCTION public.onboarding_progress(p_include_staff boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.onboarding_progress(p_include_staff) $$;
REVOKE ALL ON FUNCTION rejoyce_security.onboarding_progress(boolean),public.onboarding_progress(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.onboarding_progress(boolean),public.onboarding_progress(boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

