-- Self-cleaning fixtures; run with a database administrator connection.
DO $branch_tests$
DECLARE
  oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); delegate_id uuid:=gen_random_uuid();
  os uuid:=gen_random_uuid(); ss uuid:=gen_random_uuid(); ds uuid:=gen_random_uuid();
  a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid(); b1 uuid:=gen_random_uuid();
  ca uuid; cb uuid; other_client uuid; n integer; before_count integer;
BEGIN
  BEGIN
    INSERT INTO public.organizations(id,name) VALUES(oa,'Branch test A'),(ob,'Branch test B');
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      (owner_id,owner_id::text||'@example.invalid','{}'),
      (staff_id,staff_id::text||'@example.invalid','{}'),
      (delegate_id,delegate_id::text||'@example.invalid','{}');
    UPDATE public.users SET organization_id=oa,status='active',pin_hash='synthetic',pin_reset_required=false
      WHERE id IN(owner_id,staff_id,delegate_id);
    UPDATE public.users SET role='owner' WHERE id=owner_id;
    UPDATE public.users SET role='teacher' WHERE id IN(staff_id,delegate_id);
    INSERT INTO public.user_permissions(user_id,organization_id,can_manage_clients,can_manage_sessions)
      VALUES(delegate_id,oa,true,false);
    INSERT INTO auth.sessions(id,user_id,created_at)
      VALUES(os,owner_id,now()),(ss,staff_id,now()),(ds,delegate_id,now());
    INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
      VALUES(os,owner_id,now(),now(),now()+interval '5 minutes'),
            (ss,staff_id,now(),now(),now()+interval '5 minutes'),
            (ds,delegate_id,now(),now(),now()+interval '5 minutes');
    INSERT INTO public.organization_locations(id,organization_id,name,active)
      VALUES(a1,oa,'North',true),(a2,oa,'South',true),(inactive_id,oa,'Archived',false),(b1,ob,'Foreign',true);
    INSERT INTO public.clients(organization_id,first_name) VALUES(ob,'Foreign client') RETURNING id INTO cb;
    INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(cb,b1,ob);
    PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',os,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    ca:=public.create_client_with_locations('Synthetic','Client',NULL,staff_id,ARRAY[a1,a2,a1]);
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>2 THEN RAISE EXCEPTION 'Multiple branch assignment or deduplication failed'; END IF;
    SELECT count(*) INTO before_count FROM public.clients;
    BEGIN
      PERFORM public.create_client_with_locations('Must roll back',NULL,NULL,NULL,ARRAY[a1,b1]);
      RAISE EXCEPTION 'Foreign branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    SELECT count(*) INTO n FROM public.clients;
    IF n<>before_count THEN RAISE EXCEPTION 'Failed assignment left a partial client'; END IF;
    BEGIN
      PERFORM public.create_client_with_locations('No branches',NULL,NULL,NULL,ARRAY[]::uuid[]);
      RAISE EXCEPTION 'Empty selection accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[a1,NULL]::uuid[]);
      RAISE EXCEPTION 'Null branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[inactive_id]);
      RAISE EXCEPTION 'New inactive branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(cb,ARRAY[a1]);
      RAISE EXCEPTION 'Foreign client edit accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=cb;
    IF n<>0 THEN RAISE EXCEPTION 'Foreign branch memberships leaked'; END IF;
    UPDATE public.organization_locations SET active=false WHERE id=a2;
    PERFORM public.set_client_locations(ca,ARRAY[a1,a2]);
    PERFORM public.set_client_locations(ca,ARRAY[a1]);
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>1 THEN RAISE EXCEPTION 'Replace branch set failed'; END IF;
    BEGIN
      DELETE FROM public.organization_locations WHERE id=a1;
      RAISE EXCEPTION 'Deleting assigned branch created orphan';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    other_client:=public.create_client_with_locations('Unassigned to staff',NULL,NULL,NULL,ARRAY[a1]);
    RESET ROLE;

    -- Even service-side mistakes cannot create cross-company membership rows.
    BEGIN
      INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(ca,b1,oa);
      RAISE EXCEPTION 'Cross-company relationship bypassed FK';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(cb,a1,oa);
      RAISE EXCEPTION 'Foreign client bypassed FK';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.client_locations SET organization_id=ob WHERE client_id=ca;
      RAISE EXCEPTION 'Existing membership moved company';
    EXCEPTION WHEN check_violation THEN NULL; END;

    PERFORM set_config('request.jwt.claim.sub',staff_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'session_id',ss,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>1 THEN RAISE EXCEPTION 'Assigned staff cannot read client branches'; END IF;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=other_client OR client_id=cb;
    IF n<>0 THEN RAISE EXCEPTION 'Unassigned or foreign client membership leaked'; END IF;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[inactive_id]);
      RAISE EXCEPTION 'Staff changed branches';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.create_client_with_locations('Unauthorized',NULL,NULL,NULL,ARRAY[a1]);
      RAISE EXCEPTION 'Staff created client';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    -- A client-management grant works without requiring session-management rights.
    PERFORM set_config('request.jwt.claim.sub',delegate_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',delegate_id,'session_id',ds,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM public.set_client_locations(ca,ARRAY[a1]);
    PERFORM public.create_client_with_locations('Delegated client',NULL,NULL,NULL,ARRAY[a1]);
    RESET ROLE;

    UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=ds;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>0 THEN RAISE EXCEPTION 'Locked session read memberships'; END IF;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[a1]);
      RAISE EXCEPTION 'Locked session wrote memberships';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    IF has_function_privilege('anon','public.set_client_locations(uuid,uuid[])','EXECUTE')
      OR has_function_privilege('anon','public.create_client_with_locations(text,text,text,uuid,uuid[])','EXECUTE')
      OR has_table_privilege('authenticated','public.client_locations','TRUNCATE')
    THEN RAISE EXCEPTION 'Unsafe branch API privileges'; END IF;
    DELETE FROM public.clients WHERE id=ca;
    IF EXISTS(SELECT 1 FROM public.client_locations WHERE client_id=ca) THEN RAISE EXCEPTION 'Client delete left memberships'; END IF;
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Discard successful branch fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$branch_tests$;

SELECT 'PASS: multiple branches, atomic creation, tenant FKs/RLS, staff and delegated permission checks, inactive branch handling, locked session and anonymous denial, fixture rollback' AS result;
