-- All synthetic fixtures are rolled back on both success and failure.
DO $tests$
DECLARE
  org uuid := gen_random_uuid(); foreign_org uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); provider_id uuid := gen_random_uuid();
  device_id uuid := gen_random_uuid(); provider_device uuid := gen_random_uuid();
  destination uuid := gen_random_uuid(); origin_client uuid := gen_random_uuid();
  foreign_client uuid := gen_random_uuid(); source_id uuid; foreign_source uuid;
  assignment uuid; result_id uuid; result jsonb; prepared_session uuid;
  mode text; kind text; n integer;
BEGIN
  BEGIN
    INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic setup release'),(foreign_org,'Synthetic foreign release');
    INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id::text||'@example.invalid'),(provider_id,provider_id::text||'@example.invalid');
    INSERT INTO public.users(id,organization_id,email,full_name,role,status,pin_hash,pin_reset_required)
      VALUES(owner_id,org,owner_id::text||'@example.invalid','Synthetic owner','owner','active','synthetic',false),
      (provider_id,org,provider_id::text||'@example.invalid','Synthetic provider','teacher','active','synthetic',false)
      ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,status='active',pin_hash='synthetic',pin_reset_required=false;
    INSERT INTO auth.sessions(id,user_id) VALUES(device_id,owner_id),(provider_device,provider_id);
    INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
      VALUES(device_id,owner_id,now(),now(),now()+interval '1 hour'),(provider_device,provider_id,now(),now(),now()+interval '1 hour');
    INSERT INTO public.clients(id,organization_id,first_name)
      VALUES(destination,org,'Synthetic destination'),(origin_client,org,'Synthetic source'),(foreign_client,foreign_org,'Synthetic foreign');
    INSERT INTO public.client_behaviors(organization_id,client_id,name,description,measurement_type)
      VALUES(org,origin_client,'Synthetic reusable behavior','Original guidance','frequency') RETURNING id INTO source_id;
    INSERT INTO public.client_behaviors(organization_id,client_id,name,measurement_type)
      VALUES(foreign_org,foreign_client,'Foreign definition','frequency') RETURNING id INTO foreign_source;
    INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes)
      VALUES(org,'Synthetic direct service','direct_therapy',60);
    PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',device_id,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    assignment := public.apply_client_behavior(destination,source_id);
    result_id := public.apply_client_behavior(destination,source_id);
    IF assignment <> result_id THEN RAISE EXCEPTION 'Repeated application duplicated assignment'; END IF;
    SELECT count(*) INTO n FROM public.client_behaviors WHERE client_id=destination;
    IF n <> 1 THEN RAISE EXCEPTION 'Expected exactly one assignment'; END IF;
    UPDATE public.client_behaviors SET active=false,description='Individualized guidance' WHERE id=assignment;
    result_id := public.apply_client_behavior(destination,source_id);
    IF result_id <> assignment OR NOT EXISTS(SELECT 1 FROM public.client_behaviors WHERE id=assignment AND active AND description='Individualized guidance') THEN
      RAISE EXCEPTION 'Reactivation did not preserve individualized guidance';
    END IF;
    BEGIN PERFORM public.apply_client_behavior(foreign_client,source_id); RAISE EXCEPTION 'Foreign client accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.apply_client_behavior(destination,foreign_source); RAISE EXCEPTION 'Foreign definition accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    FOREACH kind IN ARRAY ARRAY['discrete_trial','frequency','duration','interval','task_analysis','natural_environment','other'] LOOP
      FOREACH mode IN ARRAY ARRAY['independent_prompted_retry','correct_incorrect','frequency','duration','custom'] LOOP
        INSERT INTO public.client_targets(organization_id,client_id,title,target_type,response_mode)
          VALUES(org,destination,kind||'/'||mode,kind,mode);
      END LOOP;
    END LOOP;
    BEGIN INSERT INTO public.client_targets(organization_id,client_id,title,response_mode) VALUES(org,destination,'Invalid','independent_prompted'); RAISE EXCEPTION 'Invalid mode accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    result := public.create_prepared_session(destination,provider_id,now(),now()+interval '1 hour','direct_therapy',NULL);
    prepared_session := (result->>'session_id')::uuid;
    IF (result->>'targets_added')::integer <> 35 THEN RAISE EXCEPTION 'Session did not prepare all target modes'; END IF;
    SELECT count(*) INTO n FROM public.session_targets st JOIN public.client_targets ct ON ct.id=st.client_target_id
      WHERE st.session_id=prepared_session AND st.response_mode=ct.response_mode;
    IF n <> 35 THEN RAISE EXCEPTION 'Session response modes changed'; END IF;
    PERFORM set_config('request.jwt.claim.sub',provider_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',provider_id,'session_id',provider_device,'role','authenticated')::text,true);
    SELECT count(*) INTO n FROM public.client_behaviors WHERE client_id=destination AND active;
    IF n <> 1 THEN RAISE EXCEPTION 'Session provider cannot see applied behavior'; END IF;
    BEGIN PERFORM public.apply_client_behavior(destination,source_id); RAISE EXCEPTION 'Staff assignment write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM public.start_assigned_session(prepared_session);
    PERFORM public.record_behavior_event(prepared_session,assignment);
    RESET ROLE;
    UPDATE public.device_sessions SET revoked=true WHERE session_id=device_id;
    PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',device_id,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.apply_client_behavior(destination,source_id); RAISE EXCEPTION 'Revoked device accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    UPDATE public.device_sessions SET revoked=false,unlocked_until=now()-interval '1 second' WHERE session_id=device_id;
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.apply_client_behavior(destination,source_id); RAISE EXCEPTION 'Locked device accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    UPDATE public.device_sessions SET unlocked_until=now()+interval '1 hour' WHERE session_id=device_id;
    INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload)
      VALUES(org,owner_id,now()-interval '30 days',now()-interval '1 day','{}');
    UPDATE public.client_behaviors SET active=false WHERE id=assignment;
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.apply_client_behavior(destination,source_id); RAISE EXCEPTION 'Expired subscription write accepted'; EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
    RESET ROLE;
    IF has_function_privilege('anon','public.apply_client_behavior(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute grant'; END IF;
    RAISE EXCEPTION 'Rollback successful synthetic release tests' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$tests$;
SELECT 'client session setup passed; all synthetic fixtures rolled back' AS result;
