-- Deploy the PIN status endpoint and updated pages before applying this migration.
-- A column REVOKE alone is insufficient while table-wide SELECT is granted.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT ON TABLE public.users FROM PUBLIC, anon, authenticated;
REVOKE SELECT (pin_hash) ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, full_name, role, created_at, username,
  is_active, status, email, pin_reset_required
) ON TABLE public.users TO authenticated;
-- Existing RLS still limits which profiles are visible. The privileged server
-- client retains its existing access for PIN verification and PIN setup.
DO $verify$
BEGIN
  IF has_column_privilege('anon', 'public.users', 'pin_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.users', 'pin_hash', 'SELECT') THEN
    RAISE EXCEPTION 'Browser roles must not read PIN hashes';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.users', 'pin_hash', 'SELECT') THEN
    RAISE EXCEPTION 'Server PIN verification requires credential access';
  END IF;
END
$verify$;
NOTIFY pgrst, 'reload schema';
COMMIT;
