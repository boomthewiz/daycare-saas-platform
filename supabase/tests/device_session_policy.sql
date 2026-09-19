BEGIN;
DO $test$
DECLARE
  uid uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  org uuid := gen_random_uuid();
  proof text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  result jsonb;
  visible integer;
  baseline timestamptz;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,uid::text||'@example.invalid','{}');
  INSERT INTO public.organizations(id,name) VALUES(org,'Session policy test');
  UPDATE public.users SET organization_id=org,role='owner',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=uid;
  INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,uid,clock_timestamp());
  UPDATE rejoyce_security.session_policy SET enforced=true WHERE singleton;
  result := public.manage_device_session(uid,sid,'status');
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'Untrusted Auth session accepted'; END IF;
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'PIN bootstrapped full authentication'; END IF;
  INSERT INTO public.email_login_challenges(proof_hash,user_id) VALUES(proof,uid);
  result := public.manage_device_session(gen_random_uuid(),sid,'complete_email',proof);
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'Wrong-user proof accepted'; END IF;
  result := public.manage_device_session(uid,sid,'complete_email',proof);
  IF result->>'state' <> 'unlocked' THEN RAISE EXCEPTION 'Email proof failed'; END IF;
  SELECT full_auth_at INTO baseline FROM public.device_sessions WHERE session_id=sid;
  result := public.manage_device_session(uid,sid,'complete_email',proof);
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'Proof replay accepted'; END IF;
  PERFORM set_config('request.jwt.claim.sub',uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(id) INTO visible FROM public.users WHERE id=uid;
  IF visible <> 1 OR public.current_organization_id() IS DISTINCT FROM org THEN RAISE EXCEPTION 'Unlocked access blocked'; END IF;
  BEGIN
    PERFORM public.manage_device_session(uid,sid,'unlock');
    RAISE EXCEPTION 'Browser can bypass PIN';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.device_sessions SET unlocked_until=clock_timestamp()+interval '1 day';
    RAISE EXCEPTION 'Browser can extend session';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.device_sessions SET unlocked_until=clock_timestamp()-interval '1 second' WHERE session_id=sid;
  result := public.manage_device_session(uid,sid,'activity');
  IF result->>'state' <> 'locked' THEN RAISE EXCEPTION 'Heartbeat bypassed lock'; END IF;
  SET LOCAL ROLE authenticated;
  SELECT count(id) INTO visible FROM public.users WHERE id=uid;
  IF visible <> 0 OR public.current_organization_id() IS NOT NULL THEN RAISE EXCEPTION 'Locked RLS or SQL RPC leaked data'; END IF;
  BEGIN
    PERFORM public.start_assigned_session(gen_random_uuid());
    RAISE EXCEPTION 'Locked definer RPC permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'unlocked' THEN RAISE EXCEPTION 'PIN unlock failed'; END IF;
  IF (SELECT full_auth_at FROM public.device_sessions WHERE session_id=sid) <> baseline THEN RAISE EXCEPTION 'PIN reset full-auth clock'; END IF;
  UPDATE public.device_sessions SET full_auth_at=clock_timestamp()-interval '30 days',last_pin_at=clock_timestamp() WHERE session_id=sid;
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION '30-day limit bypassed'; END IF;
  UPDATE public.device_sessions SET full_auth_at=clock_timestamp()-interval '8 days',last_pin_at=clock_timestamp()-interval '7 days' WHERE session_id=sid;
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'Seven-day PIN absence bypassed'; END IF;
  UPDATE public.device_sessions SET full_auth_at=clock_timestamp()-interval '29 days',last_pin_at=clock_timestamp()-interval '6 days' WHERE session_id=sid;
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'unlocked' THEN RAISE EXCEPTION 'Valid remembered device rejected'; END IF;
  result := public.manage_device_session(uid,sid,'logout');
  result := public.manage_device_session(uid,sid,'unlock');
  IF result->>'state' <> 'full_login' THEN RAISE EXCEPTION 'Revoked session revived'; END IF;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.manage_device_session(uid,sid,'complete_email',proof);
    RAISE EXCEPTION 'Anonymous management RPC permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END
$test$;
ROLLBACK;
SELECT 'PASS: email proof required and single-use; RLS/RPC lock enforced; activity cannot unlock; PIN cannot extend 30 days or revive seven-day inactivity; logout revoked; browser mutation denied' AS result;
