-- Synthetic accounts only; every fixture and JWT setting rolls back.
BEGIN;
DO $test$
DECLARE
  org uuid := gen_random_uuid();
  foreign_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  target uuid := gen_random_uuid();
  owner_target uuid := gen_random_uuid();
  foreign_target uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  denied boolean;
  affected integer;
  actor_role text;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Delegation regression'),(foreign_org,'Foreign delegation regression');
  INSERT INTO auth.users(id,email,raw_user_meta_data)
    SELECT uid,uid::text||'@example.invalid','{}'::jsonb FROM unnest(ARRAY[actor,target,owner_target,foreign_target]) AS uid;
  UPDATE public.users SET organization_id=org,role='staff',status='active',pin_hash='synthetic',pin_reset_required=false
    WHERE id IN (actor,target,owner_target);
  UPDATE public.users SET role='owner' WHERE id=owner_target;
  UPDATE public.users SET organization_id=foreign_org,role='staff',status='active' WHERE id=foreign_target;
  INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,actor,clock_timestamp());
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    VALUES(sid,actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes');
  INSERT INTO public.user_permissions(user_id,organization_id,can_manage_users)
    VALUES(actor,org,true),(target,org,false),(owner_target,org,false),(foreign_target,foreign_org,false);
  IF (SELECT can_delegate_permissions FROM public.user_permissions WHERE user_id=actor) IS DISTINCT FROM false
    THEN RAISE EXCEPTION 'Delegation is not disabled by default'; END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true);

  FOREACH actor_role IN ARRAY ARRAY['manager','director','staff'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    UPDATE public.user_permissions SET can_delegate_permissions=false WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_view_reports=true WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% changed grants without delegation',actor_role; END IF;
    denied := false;
    BEGIN
      INSERT INTO public.user_permissions(user_id,organization_id,can_view_reports)
        VALUES(target,org,true) ON CONFLICT(user_id) DO UPDATE SET can_view_reports=EXCLUDED.can_view_reports;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% bypassed delegation with upsert',actor_role; END IF;
    UPDATE public.users SET full_name='Managed without delegation' WHERE id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Manage users profile edit regressed'; END IF;
    RESET ROLE;

    UPDATE public.user_permissions SET can_delegate_permissions=true WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.user_permissions SET can_view_reports=true,can_manage_users=true WHERE user_id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION '% cannot delegate after approval',actor_role; END IF;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_delegate_permissions=true WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% granted delegation authority',actor_role; END IF;
    UPDATE public.user_permissions SET can_delegate_permissions=true WHERE user_id=actor;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Self permissions changed'; END IF;
    UPDATE public.user_permissions SET can_view_reports=true WHERE user_id IN (owner_target,foreign_target);
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Owner or foreign permissions changed'; END IF;
    RESET ROLE;

    UPDATE public.user_permissions SET can_delegate_permissions=true WHERE user_id=target;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_delegate_permissions=false WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% revoked delegation authority',actor_role; END IF;
    INSERT INTO public.user_permissions(user_id,organization_id,can_delegate_permissions,can_view_reports)
      VALUES(target,org,true,false) ON CONFLICT(user_id) DO UPDATE SET
        can_delegate_permissions=EXCLUDED.can_delegate_permissions,can_view_reports=EXCLUDED.can_view_reports;
    RESET ROLE;

    DELETE FROM public.user_permissions WHERE user_id=target;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      INSERT INTO public.user_permissions(user_id,organization_id,can_delegate_permissions) VALUES(target,org,true);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% inserted delegation authority',actor_role; END IF;
    INSERT INTO public.user_permissions(user_id,organization_id,can_view_reports) VALUES(target,org,true);
    RESET ROLE;

    UPDATE public.user_permissions SET can_delegate_permissions=false WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_view_reports=false WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Delegation revocation did not take effect'; END IF;
    RESET ROLE;
  END LOOP;

  FOREACH actor_role IN ARRAY ARRAY['owner','admin'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.user_permissions SET can_delegate_permissions=true WHERE user_id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION '% cannot enable delegation',actor_role; END IF;
    UPDATE public.user_permissions SET can_delegate_permissions=false WHERE user_id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION '% cannot revoke delegation',actor_role; END IF;
    RESET ROLE;
  END LOOP;

  UPDATE public.users SET role='manager' WHERE id=actor;
  UPDATE public.user_permissions SET can_manage_users=false,can_delegate_permissions=true WHERE user_id=actor;
  SET LOCAL ROLE authenticated;
  UPDATE public.user_permissions SET can_view_reports=false WHERE user_id=target;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Delegation alone bypassed Manage users'; END IF;
  RESET ROLE;
  UPDATE public.user_permissions SET can_manage_users=true WHERE user_id=actor;
  UPDATE public.device_sessions SET unlocked_until=clock_timestamp()-interval '1 second' WHERE session_id=sid;
  SET LOCAL ROLE authenticated;
  UPDATE public.user_permissions SET can_view_reports=false WHERE user_id=target;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Locked session delegated permissions'; END IF;
  RESET ROLE;
END;
$test$;
ROLLBACK;
SELECT 'PASS: owner/admin-controlled delegation defaults off; approved delegation works; recursive delegation and self/owner/foreign changes blocked; revocation immediate; Manage users and unlocked session required; fixtures rolled back' AS result;
