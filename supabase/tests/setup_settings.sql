-- Isolated synthetic verification of the unchanged Setup authorization policies.
BEGIN;
DO $test$
DECLARE
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid(); sid uuid := gen_random_uuid();
  branch uuid := gen_random_uuid(); foreign_branch uuid := gen_random_uuid();
  service uuid := gen_random_uuid(); category uuid := gen_random_uuid();
  actor_role text; affected integer; denied boolean;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic setup'),(other_org,'Synthetic foreign setup');
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required)
    VALUES(actor,org,'staff','active','synthetic',false)
    ON CONFLICT(id) DO UPDATE SET organization_id=org,role='staff',status='active',pin_hash='synthetic',pin_reset_required=false;
  INSERT INTO auth.sessions(id,user_id) VALUES(sid,actor);
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    VALUES(sid,actor,now(),now(),now()+interval '1 hour');
  INSERT INTO public.user_permissions(user_id,organization_id) VALUES(actor,org);
  INSERT INTO public.organization_locations(id,organization_id,name) VALUES(branch,org,'Synthetic branch'),(foreign_branch,other_org,'Foreign');
  INSERT INTO public.session_types(id,organization_id,name,code,default_duration_minutes) VALUES(service,org,'Synthetic service','synthetic',60);
  INSERT INTO public.target_categories(id,organization_id,name) VALUES(category,org,'Synthetic category');
  INSERT INTO public.organization_terminology(organization_id) VALUES(org);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true);
  FOREACH actor_role IN ARRAY ARRAY['staff','admin','manager','director'] LOOP
    UPDATE public.users SET role=actor_role WHERE id=actor;
    UPDATE public.user_permissions SET can_manage_sessions=false,can_manage_clients=false WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.organization_locations SET name='Denied' WHERE id=branch;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION '% edited branches without grant',actor_role; END IF;
    UPDATE public.session_types SET default_duration_minutes=30 WHERE id=service;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION '% edited session type without grant',actor_role; END IF;
    UPDATE public.target_categories SET name='Denied' WHERE id=category;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION '% edited categories without grant',actor_role; END IF;
    UPDATE public.organization_terminology SET client_singular='Denied' WHERE organization_id=org;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION '% edited terminology without grant',actor_role; END IF;
    denied:=false;
    BEGIN INSERT INTO public.organization_locations(organization_id,name) VALUES(org,'Denied insert');
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Unauthorized direct insert accepted'; END IF;
    RESET ROLE;
    UPDATE public.user_permissions SET can_manage_sessions=true WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.organization_locations SET name='Allowed branch' WHERE id=branch;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Delegated branch edit failed'; END IF;
    UPDATE public.session_types SET default_duration_minutes=45 WHERE id=service;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Delegated duration edit failed'; END IF;
    UPDATE public.organization_terminology SET client_singular='Person' WHERE organization_id=org;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Delegated terminology edit failed'; END IF;
    UPDATE public.organization_locations SET name='Foreign edit' WHERE id=foreign_branch;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Business isolation failed'; END IF;
    UPDATE public.target_categories SET name='Denied category' WHERE id=category;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Session grant edited categories'; END IF;
    RESET ROLE;
    UPDATE public.user_permissions SET can_manage_sessions=false,can_manage_clients=true WHERE user_id=actor;
    SET LOCAL ROLE authenticated;
    UPDATE public.target_categories SET name='Allowed category' WHERE id=category;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Client grant category edit failed'; END IF;
    UPDATE public.organization_terminology SET client_singular='Client' WHERE organization_id=org;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Client grant terminology edit failed'; END IF;
    UPDATE public.session_types SET default_duration_minutes=30 WHERE id=service;
    GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Client grant edited session types'; END IF;
    RESET ROLE;
  END LOOP;
  UPDATE public.users SET role='owner' WHERE id=actor;
  UPDATE public.user_permissions SET can_manage_sessions=false,can_manage_clients=false WHERE user_id=actor;
  SET LOCAL ROLE authenticated;
  UPDATE public.session_types SET default_duration_minutes=90 WHERE id=service;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Owner authority lost'; END IF;
  RESET ROLE;
  UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=sid;
  SET LOCAL ROLE authenticated;
  UPDATE public.session_types SET default_duration_minutes=120 WHERE id=service;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Locked device changed setup'; END IF;
  RESET ROLE;
  UPDATE public.device_sessions SET unlocked_until=now()+interval '1 hour',revoked=true WHERE session_id=sid;
  SET LOCAL ROLE authenticated;
  UPDATE public.organization_locations SET name='Revoked' WHERE id=branch;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Revoked device changed setup'; END IF;
  RESET ROLE;
  UPDATE public.device_sessions SET revoked=false WHERE session_id=sid;
  INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload)
    VALUES(org,actor,now()-interval '40 days',now()-interval '1 day','{}');
  SET LOCAL ROLE authenticated;
  denied:=false;
  BEGIN UPDATE public.session_types SET default_duration_minutes=120 WHERE id=service;
  EXCEPTION WHEN SQLSTATE 'P4020' THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Expired subscription changed setup'; END IF;
  RESET ROLE;
END;
$test$;
ROLLBACK;
