-- Self-cleaning synthetic fixtures. Successful and failed runs persist no data.
DO $tests$
DECLARE
  oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); delegate_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid();
  north uuid:=gen_random_uuid(); south uuid:=gen_random_uuid(); other_branch uuid:=gen_random_uuid();
  os uuid:=gen_random_uuid(); ds uuid:=gen_random_uuid(); asid uuid:=gen_random_uuid(); bsid uuid:=gen_random_uuid(); ads uuid:=gen_random_uuid();
  cid uuid; gid uuid; second_gid uuid; ver integer; n integer; ctx jsonb; sid uuid; before_count integer;
BEGIN
  BEGIN
  INSERT INTO public.organizations(id,name) VALUES(oa,'Synthetic care A'),(ob,'Synthetic care B');
  INSERT INTO auth.users(id,email) SELECT id,id::text||'@example.invalid' FROM unnest(ARRAY[owner_id,delegate_id,admin_id,a,b,foreign_id,inactive_id]) id;
  INSERT INTO public.users(id,organization_id,full_name,role,status,pin_hash,pin_reset_required)
    VALUES(owner_id,oa,'Synthetic owner','owner','active','synthetic',false),
    (delegate_id,oa,'Synthetic delegate','teacher','active','synthetic',false),
    (admin_id,oa,'Synthetic admin without grants','admin','active','synthetic',false),
    (a,oa,'Synthetic A','teacher','active','synthetic',false),
    (b,oa,'Synthetic B','aide','active','synthetic',false),
    (foreign_id,ob,'Synthetic foreign','teacher','active','synthetic',false),
    (inactive_id,oa,'Synthetic inactive','teacher','inactive','synthetic',false)
    ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,pin_hash='synthetic',pin_reset_required=false;
  INSERT INTO public.user_permissions(user_id,organization_id,can_manage_clients) VALUES(delegate_id,oa,true);
  INSERT INTO auth.sessions(id,user_id) VALUES(os,owner_id),(ds,delegate_id),(asid,a),(bsid,b),(ads,admin_id);
  INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
    SELECT id,user_id,now(),now(),now()+interval '1 hour' FROM auth.sessions WHERE id=ANY(ARRAY[os,ds,asid,bsid,ads]);
  INSERT INTO public.organization_locations(id,organization_id,name) VALUES(north,oa,'Synthetic North'),(south,oa,'Synthetic South'),(other_branch,ob,'Synthetic foreign branch');
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',os,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM public.save_staff_locations(a,ARRAY[north],'{}');
  PERFORM public.save_staff_locations(b,ARRAY[north,south],'{}');
  gid:=public.save_care_group(NULL,'Synthetic class','class',north,ARRAY[a,b,a],NULL);
  second_gid:=public.save_care_group(NULL,'Synthetic team','team',north,ARRAY[a,b],NULL);
  ctx:=public.care_context(NULL);
  IF jsonb_array_length(ctx->'staff')<>4 THEN RAISE EXCEPTION 'Directory leaked users or omitted care staff'; END IF;
  IF ctx::text LIKE '%pin_hash%' OR ctx::text LIKE '%example.invalid%' THEN RAISE EXCEPTION 'Directory exposed private profile fields'; END IF;
  cid:=public.create_client_with_care_team('Synthetic client',NULL,NULL,ARRAY[north],ARRAY[a,b,a],a);
  SELECT count(*) INTO n FROM public.client_care_members WHERE client_id=cid;
  IF n<>2 THEN RAISE EXCEPTION 'Duplicate members persisted'; END IF;
  ver:=public.set_client_care_team(cid,ARRAY[b],b,1);
  IF ver<>2 THEN RAISE EXCEPTION 'Assignment version failed'; END IF;
  ctx:=public.care_context(cid);
  IF ctx->'member_ids'<>jsonb_build_array(b) OR ctx->>'primary_id'<>b::text THEN RAISE EXCEPTION 'Exclusion or primary did not persist'; END IF;
  -- Group changes never alter the saved person set.
  PERFORM public.save_care_group(gid,'Synthetic renamed','class',north,ARRAY[a],0);
  ctx:=public.care_context(cid);
  IF ctx->'member_ids'<>jsonb_build_array(b) THEN RAISE EXCEPTION 'Group change modified snapshot assignments'; END IF;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[a],a,1); RAISE EXCEPTION 'Stale assignment accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.save_care_group(gid,'Stale','class',north,ARRAY[a],0); RAISE EXCEPTION 'Stale group accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.save_staff_locations(a,ARRAY[south],'{}'); RAISE EXCEPTION 'Stale staff setup accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[foreign_id],NULL,ver); RAISE EXCEPTION 'Foreign person accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[inactive_id],NULL,ver); RAISE EXCEPTION 'Inactive person accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[b],a,ver); RAISE EXCEPTION 'Unselected primary accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[b,NULL],NULL,ver); RAISE EXCEPTION 'Null member accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.save_staff_locations(a,ARRAY[other_branch],ARRAY[north]); RAISE EXCEPTION 'Foreign branch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.save_care_group(NULL,'Foreign','group',other_branch,ARRAY[a],NULL); RAISE EXCEPTION 'Foreign group branch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.save_care_group(NULL,'Wrong branch','group',south,ARRAY[a],NULL); RAISE EXCEPTION 'Wrong group member branch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE public.clients SET assigned_provider_id=a WHERE id=cid; RAISE EXCEPTION 'Primary shortcut bypassed selection'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN INSERT INTO public.client_care_members VALUES(oa,cid,a); RAISE EXCEPTION 'Direct assignment write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Staff without branch setup cannot be selected, and failed creation is atomic.
  SELECT count(*) INTO before_count FROM public.clients;
  BEGIN PERFORM public.create_client_with_care_team('Must roll back',NULL,NULL,ARRAY[north],ARRAY[delegate_id],NULL); RAISE EXCEPTION 'Unset staff branches accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT count(*) INTO n FROM public.clients;
  IF n<>before_count THEN RAISE EXCEPTION 'Failed create left partial client'; END IF;
  BEGIN PERFORM public.create_client_with_care_team('Foreign branch',NULL,NULL,ARRAY[other_branch],ARRAY[b],NULL); RAISE EXCEPTION 'Foreign client branch accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- Existing authorized creators retain assignment and setup capabilities.
  PERFORM set_config('request.jwt.claim.sub',delegate_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',delegate_id,'session_id',ds,'role','authenticated')::text,true);
  PERFORM public.set_client_care_team(cid,ARRAY[b],b,ver);
  PERFORM public.save_staff_locations(delegate_id,ARRAY[north],'{}');
  RESET ROLE;
  INSERT INTO public.client_targets(organization_id,client_id,title) VALUES(oa,cid,'Synthetic target');
  INSERT INTO public.client_behaviors(organization_id,client_id,name) VALUES(oa,cid,'Synthetic behavior');
  INSERT INTO public.sessions(organization_id,client_id,provider_id,session_type,scheduled_start,scheduled_end,status)
    VALUES(oa,cid,a,'direct_therapy',now(),now()+interval '1 hour','scheduled') RETURNING id INTO sid;
  -- B's client care assignment grants profile/target/behavior read, never A's session.
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'session_id',bsid,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>1 THEN RAISE EXCEPTION 'Care member cannot read client'; END IF;
  SELECT count(*) INTO n FROM public.client_targets WHERE client_id=cid; IF n<>1 THEN RAISE EXCEPTION 'Care member cannot read targets'; END IF;
  SELECT count(*) INTO n FROM public.client_behaviors WHERE client_id=cid; IF n<>1 THEN RAISE EXCEPTION 'Care member cannot read behaviors'; END IF;
  SELECT count(*) INTO n FROM public.sessions WHERE id=sid; IF n<>0 THEN RAISE EXCEPTION 'Care assignment leaked other worker session'; END IF;
  BEGIN PERFORM public.set_client_care_team(cid,ARRAY[a],a,3); RAISE EXCEPTION 'Staff edited care team'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.care_context(cid); RAISE EXCEPTION 'Staff read care directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Disabled or revoked devices deny new and old assignment paths.
  RESET ROLE;
  UPDATE public.device_sessions SET revoked=true WHERE session_id=bsid;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>0 THEN RAISE EXCEPTION 'Revoked device read client'; END IF;
  RESET ROLE;
  UPDATE public.device_sessions SET revoked=false WHERE session_id=bsid;
  UPDATE public.organization_locations SET active=false WHERE id=north;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>0 THEN RAISE EXCEPTION 'Inactive branch granted care access'; END IF;
  RESET ROLE;
  UPDATE public.organization_locations SET active=true WHERE id=north;
  UPDATE public.users SET status='disabled' WHERE id=b;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>0 THEN RAISE EXCEPTION 'Disabled staff retained care access'; END IF;
  RESET ROLE;
  UPDATE public.users SET status='active' WHERE id=b;
  BEGIN INSERT INTO public.client_care_members VALUES(ob,cid,foreign_id); RAISE EXCEPTION 'Cross-tenant care FK bypassed'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN INSERT INTO public.staff_locations VALUES(oa,a,other_branch); RAISE EXCEPTION 'Cross-tenant staff branch FK bypassed'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  -- Removing shared eligibility stops this assignment access immediately.
  DELETE FROM public.staff_locations WHERE user_id=b AND location_id=north;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>0 THEN RAISE EXCEPTION 'Wrong-branch care access retained'; END IF;
  RESET ROLE;
  -- Session assignment still grants its existing access even without care membership.
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',asid,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=cid; IF n<>1 THEN RAISE EXCEPTION 'Existing session-based client access lost'; END IF;
  RESET ROLE;
  -- An admin title without the existing client grant cannot create/assign clients.
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'session_id',ads,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.create_client_with_care_team('Unauthorized',NULL,NULL,ARRAY[north],'{}',NULL); RAISE EXCEPTION 'Unauthorized creator accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  -- Subscription read-only enforcement also applies to setup and assignment.
  INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload)
    VALUES(oa,owner_id,now()-interval '30 days',now()-interval '1 day','{}');
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',os,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.save_staff_locations(a,ARRAY[north,south],ARRAY[north]); RAISE EXCEPTION 'Expired subscription setup write accepted'; EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
  BEGIN PERFORM public.set_client_care_team(cid,'{}',NULL,3); RAISE EXCEPTION 'Expired subscription assignment write accepted'; EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
  RESET ROLE;
  UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=os;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.care_context(cid); RAISE EXCEPTION 'Locked device read directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.save_staff_locations(a,ARRAY[north],ARRAY[north]); RAISE EXCEPTION 'Locked device wrote setup'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('anon','public.care_context(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.set_client_care_team(uuid,uuid[],uuid,integer)','EXECUTE')
    OR has_table_privilege('authenticated','public.client_care_members','INSERT')
    OR has_table_privilege('authenticated','public.staff_locations','UPDATE')
    THEN RAISE EXCEPTION 'Unsafe care-team API grants'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Discard successful care-team fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$tests$;
