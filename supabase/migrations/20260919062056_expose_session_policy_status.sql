GRANT SELECT ON rejoyce_security.session_policy TO service_role;
CREATE FUNCTION public.device_policy_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT enforced FROM rejoyce_security.session_policy WHERE singleton; $function$;
REVOKE ALL ON FUNCTION public.device_policy_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_policy_enabled() TO service_role;
NOTIFY pgrst, 'reload schema';

