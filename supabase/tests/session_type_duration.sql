-- Synthetic direct-write checks after the duration migration. No production data.
BEGIN;
DO $test$
DECLARE
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid(); sid uuid := gen_random_uuid();
  service uuid := gen_random_uuid(); foreign_service uuid := gen_random_uuid();
  mode text; operation text; denied boolean; affected integer;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic duration'),(other_org,'Synthetic other business');
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  INSERT INTO public.users(id,organization_id,role,status,pin_hash,pin_reset_required)
    VALUES(actor,org,'staff','active','synthetic',false)
    ON CONFLICT(id) DO UPDATE SET organization_id=org,role='staff',status='active',pin_hash='synthetic',pin_reset_required=false;
  INSERT INTO auth.sessions(id,user_id) VALUES(sid,actor);
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    VALUES(sid,actor,now(),now(),now()+interval '1 hour');
  INSERT INTO public.user_permissions(user_id,organization_id,can_manage_sessions) VALUES(actor,org,true);
  INSERT INTO public.session_types(id,organization_id,name,code,default_duration_minutes)
    VALUES(service,org,'Synthetic','synthetic',60),(foreign_service,other_org,'Foreign','foreign',60);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(org,'Allowed','allowed',1);
  INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(org,'Synthetic','synthetic',1440)
    ON CONFLICT(organization_id,code) DO UPDATE SET default_duration_minutes=EXCLUDED.default_duration_minutes;
  IF (SELECT default_duration_minutes FROM public.session_types WHERE id=service)<>1440 THEN RAISE EXCEPTION 'Authorized UPSERT failed'; END IF;
  denied:=false;
  BEGIN
    INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(org,'Synthetic','synthetic',60.5)
      ON CONFLICT(organization_id,code) DO UPDATE SET default_duration_minutes=EXCLUDED.default_duration_minutes;
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Authenticated fractional UPSERT accepted'; END IF;
  UPDATE public.session_types SET default_duration_minutes=1 WHERE id=foreign_service;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Foreign UPDATE accepted'; END IF;
  FOREACH operation IN ARRAY ARRAY['insert','upsert'] LOOP
    denied:=false;
    BEGIN
      IF operation='insert' THEN
        INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(other_org,'Denied','denied',60);
      ELSE
        INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(other_org,'Foreign','foreign',60)
          ON CONFLICT(organization_id,code) DO UPDATE SET default_duration_minutes=EXCLUDED.default_duration_minutes;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Foreign % accepted',operation; END IF;
  END LOOP;
  RESET ROLE;
  FOREACH mode IN ARRAY ARRAY['no-grant','locked','revoked','expired','anonymous'] LOOP
    UPDATE public.user_permissions SET can_manage_sessions=(mode<>'no-grant') WHERE user_id=actor;
    UPDATE public.device_sessions SET revoked=(mode='revoked'),unlocked_until=CASE WHEN mode='locked' THEN now()-interval '1 second' ELSE now()+interval '1 hour' END WHERE session_id=sid;
    IF mode='expired' THEN
      INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload)
        VALUES(org,actor,now()-interval '40 days',now()-interval '1 day','{}');
    END IF;
    IF mode='anonymous' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
    FOREACH operation IN ARRAY ARRAY['insert','update','upsert'] LOOP
      denied:=false;
      BEGIN
        IF operation='insert' THEN
          INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(org,'Denied',mode,60);
        ELSIF operation='update' THEN
          UPDATE public.session_types SET default_duration_minutes=60 WHERE id=service;
          GET DIAGNOSTICS affected=ROW_COUNT; denied:=(affected=0);
        ELSE
          INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes) VALUES(org,'Synthetic','synthetic',60)
            ON CONFLICT(organization_id,code) DO UPDATE SET default_duration_minutes=EXCLUDED.default_duration_minutes;
        END IF;
      EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'P4020' THEN denied:=true; END;
      IF NOT denied THEN RAISE EXCEPTION '% % accepted',mode,operation; END IF;
    END LOOP;
    RESET ROLE;
  END LOOP;
END;
$test$;
ROLLBACK;
