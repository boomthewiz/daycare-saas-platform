-- Protect the existing target role as well as validating the assigned role.
CREATE OR REPLACE FUNCTION public.can_manage_org_user(requested_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN EXISTS (
    SELECT 1 FROM public.users AS target
    WHERE target.id = requested_user_id
      AND target.organization_id = public.current_organization_id()
      AND public.can_manage_users()
      AND target.role <> 'owner'
      AND target.id <> auth.uid()
      AND (target.role <> 'admin' OR public.current_user_role() IN ('owner', 'admin'))
  ) ELSE false END;
$function$;
