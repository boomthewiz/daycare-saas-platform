-- Synthetic fixtures only. All records and JWT settings are rolled back.
BEGIN;
DO $test$
DECLARE
  org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  target uuid := gen_random_uuid();
  fresh_target uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  actor_role text;
  denied boolean;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Billing delegation regression');
  INSERT INTO auth.users(id,email,raw_user_meta_data)
    VALUES(actor,actor::text||'@example.invalid','{}'),
          (target,target::text||'@example.invalid','{}'),
          (fresh_target,fresh_target::text||'@example.invalid','{}');
  UPDATE public.users SET organization_id=org,role='staff',status='active',
    pin_hash='synthetic',pin_reset_required=false WHERE id IN (actor,target,fresh_target);
  INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,actor,clock_timestamp());
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    VALUES(sid,actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes');
  INSERT INTO public.user_permissions(user_id,organization_id,can_manage_users,can_delegate_permissions)
    VALUES(actor,org,true,true);
  INSERT INTO public.user_permissions(user_id,organization_id) VALUES(target,org);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true);

  FOREACH actor_role IN ARRAY ARRAY['manager','director','staff'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    UPDATE public.user_permissions SET can_manage_billing=false WHERE user_id=target;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_manage_billing=true WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% granted billing by UPDATE',actor_role; END IF;
    denied := false;
    BEGIN
      INSERT INTO public.user_permissions(user_id,organization_id,can_manage_billing)
        VALUES(fresh_target,org,true);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% granted billing by INSERT',actor_role; END IF;
    denied := false;
    BEGIN
      INSERT INTO public.user_permissions(user_id,organization_id,can_manage_billing)
        VALUES(target,org,true) ON CONFLICT(user_id) DO UPDATE SET can_manage_billing=EXCLUDED.can_manage_billing;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% granted billing by UPSERT',actor_role; END IF;
    RESET ROLE;

    UPDATE public.user_permissions SET can_manage_billing=true WHERE user_id=target;
    SET LOCAL ROLE authenticated;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET can_manage_billing=false WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% revoked billing',actor_role; END IF;
    denied := false;
    BEGIN
      UPDATE public.user_permissions SET user_id=fresh_target WHERE user_id=target;
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION '% moved billing to another account',actor_role; END IF;

    -- The UI sends every permission in its upsert, including disabled billing.
    INSERT INTO public.user_permissions(user_id,organization_id,can_manage_billing,can_view_reports)
      VALUES(target,org,true,true)
      ON CONFLICT(user_id) DO UPDATE SET
        can_manage_billing=EXCLUDED.can_manage_billing,can_view_reports=EXCLUDED.can_view_reports;
    IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id=target AND can_manage_billing AND can_view_reports)
      THEN RAISE EXCEPTION '% could not save other permissions',actor_role; END IF;
    INSERT INTO public.user_permissions(user_id,organization_id,can_manage_billing)
      VALUES(fresh_target,org,false);
    RESET ROLE;
    DELETE FROM public.user_permissions WHERE user_id=fresh_target;
  END LOOP;

  FOREACH actor_role IN ARRAY ARRAY['owner','admin'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.user_permissions SET can_manage_billing=false WHERE user_id=target;
    UPDATE public.user_permissions SET can_manage_billing=true WHERE user_id=target;
    INSERT INTO public.user_permissions(user_id,organization_id,can_manage_billing)
      VALUES(fresh_target,org,true);
    IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id=target AND can_manage_billing)
      OR NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id=fresh_target AND can_manage_billing)
      THEN RAISE EXCEPTION '% could not grant billing',actor_role; END IF;
    RESET ROLE;
    DELETE FROM public.user_permissions WHERE user_id=fresh_target;
  END LOOP;
END;
$test$;
ROLLBACK;
SELECT 'PASS: billing INSERT, UPDATE, UPSERT, revocation and recipient reassignment denied for manager/director/staff; unchanged grants and nonbilling saves allowed; owner/admin grants allowed; all fixtures rolled back' AS result;
