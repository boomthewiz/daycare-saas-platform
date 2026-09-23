BEGIN;
DO $test$
DECLARE
  org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  target uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  actor_role text;
  affected integer;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Administrator protection regression');
  INSERT INTO auth.users(id,email,raw_user_meta_data)
    VALUES(actor,actor::text||'@example.invalid','{}'),(target,target::text||'@example.invalid','{}');
  UPDATE public.users SET organization_id=org,role='admin',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id IN(actor,target);
  INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,actor,clock_timestamp());
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    VALUES(sid,actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes');
  INSERT INTO public.user_permissions(user_id,organization_id,can_manage_users,can_delegate_permissions)
    VALUES(actor,org,true,true),(target,org,false,false);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true);
  FOREACH actor_role IN ARRAY ARRAY['manager','director','staff'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    SET LOCAL ROLE authenticated;
    IF public.can_manage_org_user(target) THEN RAISE EXCEPTION '% authorized admin management',actor_role; END IF;
    UPDATE public.users SET full_name='Tampered' WHERE id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Administrator profile edit allowed'; END IF;
    UPDATE public.users SET status='inactive',role='staff' WHERE id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Administrator deactivation/demotion allowed'; END IF;
    UPDATE public.users SET pin_reset_required=true WHERE id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Administrator PIN reset allowed'; END IF;
    UPDATE public.user_permissions SET can_view_reports=true WHERE user_id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Administrator permission edit allowed'; END IF;
    BEGIN
      INSERT INTO public.user_permissions(user_id,organization_id,can_view_reports)
        VALUES(target,org,true) ON CONFLICT(user_id) DO UPDATE SET can_view_reports=true;
      RAISE EXCEPTION 'Administrator permission upsert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
  FOREACH actor_role IN ARRAY ARRAY['owner','admin'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    UPDATE public.users SET role='admin',status='active' WHERE id=target;
    SET LOCAL ROLE authenticated;
    IF NOT public.can_manage_org_user(target) THEN RAISE EXCEPTION '% cannot manage admin',actor_role; END IF;
    UPDATE public.user_permissions SET can_view_reports=true WHERE user_id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'Authorized permission edit denied'; END IF;
    UPDATE public.users SET status='inactive',role='staff' WHERE id=target;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'Authorized administrator management denied'; END IF;
    RESET ROLE;
  END LOOP;
END;
$test$;
ROLLBACK;
SELECT 'PASS: administrators protected from manager/director/staff profile, role, status, PIN-reset and permission writes; owners/admins retain management; fixtures rolled back' AS result;
