-- Run after the restriction migration. All synthetic records are rolled back.
BEGIN;
DO $test$
DECLARE
  org_id uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  visible_count integer;
BEGIN
  INSERT INTO public.organizations(id, name) VALUES(org_id, 'PIN security test');
  INSERT INTO public.users(id, organization_id, role, status, full_name, pin_hash)
    VALUES(owner_id, org_id, 'owner', 'active', 'Test owner', 'synthetic-only'),
          (member_id, org_id, 'staff', 'active', 'Test member', 'synthetic-only');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(full_name) INTO visible_count FROM public.users WHERE organization_id=org_id;
  IF visible_count <> 2 THEN RAISE EXCEPTION 'Authorized profile reads must remain available'; END IF;
  BEGIN
    PERFORM pin_hash FROM public.users WHERE id=owner_id;
    RAISE EXCEPTION 'Own PIN hash must not be readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pin_hash FROM public.users WHERE id=member_id;
    RAISE EXCEPTION 'Other PIN hashes must not be readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.users WHERE id=owner_id;
    RAISE EXCEPTION 'Wildcard reads must not bypass the restriction';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM id FROM public.users WHERE pin_hash IS NOT NULL;
    RAISE EXCEPTION 'Hash filters must not bypass the restriction';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM pin_hash FROM public.users;
    RAISE EXCEPTION 'Anonymous credential reads must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  SELECT count(pin_hash) INTO visible_count FROM public.users WHERE organization_id=org_id;
  IF visible_count <> 2 THEN RAISE EXCEPTION 'Server credential reads must remain available'; END IF;
  UPDATE public.users SET pin_hash='replacement-synthetic-only', pin_reset_required=false WHERE id=member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Server credential writes must remain available'; END IF;
  RESET ROLE;
END
$test$;
ROLLBACK;
SELECT 'PASS: authorized profiles readable; own/other/anonymous/wildcard/filter hash access denied; server access preserved; fixtures rolled back' AS result;
