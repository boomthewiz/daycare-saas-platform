-- Synthetic fixtures; wrap migration and this test in one rolled-back transaction.
DO $test$
DECLARE owner_id uuid:=gen_random_uuid(); provider uuid:=gen_random_uuid(); device uuid:=gen_random_uuid(); pd uuid:=gen_random_uuid();
 org uuid; org_again uuid; client uuid; running uuid; scheduled uuid; historical uuid; target uuid; n public.session_notes%rowtype;
 cutoff timestamptz:=statement_timestamp()-interval '1 minute';
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 (owner_id,owner_id::text||'@example.invalid',now(),'{}'),(provider,provider::text||'@example.invalid',now(),'{}');
 INSERT INTO auth.sessions(id,user_id,created_at) VALUES(device,owner_id,now()),(pd,provider,now());
 INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until) VALUES
 (device,owner_id,now(),now(),now()+interval '5 minutes'),(pd,provider,now(),now(),now()+interval '5 minutes');
 SET LOCAL ROLE service_role;
 org:=public.create_self_service_organization(owner_id,device,'Synthetic organization','Synthetic owner','First branch','Other');
 org_again:=public.create_self_service_organization(owner_id,device,'Synthetic organization','Synthetic owner','First branch','Other');
 IF org<>org_again THEN RAISE EXCEPTION 'Creation retry duplicated organization'; END IF;
 BEGIN
  PERFORM public.create_self_service_organization(owner_id,device,'Another organization','Synthetic owner','First branch','Other');
  RAISE EXCEPTION 'Duplicate trial allowed';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 RESET ROLE;
 IF (SELECT count(*) FROM public.organization_locations WHERE organization_id=org)<>1 THEN RAISE EXCEPTION 'First branch missing'; END IF;
 IF (SELECT role FROM public.users WHERE id=owner_id)<>'owner' THEN RAISE EXCEPTION 'Creator is not owner'; END IF;
 IF (SELECT trial_ends_at-created_at FROM rejoyce_security.organization_subscriptions WHERE organization_id=org)<>interval '30 days' THEN RAISE EXCEPTION 'Wrong trial'; END IF;
 UPDATE public.users SET organization_id=org,role='teacher',pin_hash='synthetic' WHERE id=provider;
 UPDATE public.users SET pin_hash='synthetic' WHERE id=owner_id;
 INSERT INTO public.clients(organization_id,first_name,assigned_provider_id) VALUES(org,'Synthetic client',provider) RETURNING id INTO client;
 INSERT INTO public.sessions(organization_id,client_id,provider_id,status,started_at) VALUES(org,client,provider,'in_progress',cutoff-interval '1 hour') RETURNING id INTO running;
 INSERT INTO public.sessions(organization_id,client_id,provider_id) VALUES(org,client,provider) RETURNING id INTO scheduled;
 INSERT INTO public.sessions(organization_id,client_id,provider_id,status,started_at,completed_at) VALUES(org,client,provider,'completed',cutoff-interval '2 hours',cutoff-interval '1 hour') RETURNING id INTO historical;
 INSERT INTO public.session_targets(organization_id,session_id,title) VALUES(org,running,'Synthetic target') RETURNING id INTO target;
 UPDATE rejoyce_security.organization_subscriptions SET created_at=cutoff-interval '30 days',trial_ends_at=cutoff WHERE organization_id=org;
 PERFORM set_config('request.jwt.claim.sub',provider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',provider,'session_id',pd,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF (public.subscription_access(running)->>'canWrite')::boolean THEN RAISE EXCEPTION 'Expired trial writable'; END IF;
 IF NOT (public.subscription_access(running)->>'canFinishSession')::boolean THEN RAISE EXCEPTION 'Exception missing'; END IF;
 IF (public.subscription_access(scheduled)->>'canFinishSession')::boolean THEN RAISE EXCEPTION 'Scheduled session exception'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE id=running) THEN RAISE EXCEPTION 'Read access lost'; END IF;
 BEGIN
  PERFORM public.start_assigned_session(scheduled);
  RAISE EXCEPTION 'Expired trial started new session';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 BEGIN
  PERFORM public.mutate_session_note(historical,'save',0,gen_random_uuid(),'Historical edit',null,null);
  RAISE EXCEPTION 'Historical note exception';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 PERFORM public.pause_assigned_session(running);
 PERFORM public.resume_assigned_session(running);
 PERFORM public.record_target_response(target,'independent',null,null);
 n:=public.mutate_session_note(running,'save',0,gen_random_uuid(),'Trial expired during service',null,null);
 BEGIN
  PERFORM public.mutate_session_note(running,'submit',n.version,gen_random_uuid(),'Premature',null,null);
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Submitted before completion';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 PERFORM public.finish_assigned_session(running);
 n:=public.mutate_session_note(running,'submit',n.version,gen_random_uuid(),'Completed after trial',null,null);
 IF n.status<>'submitted' THEN RAISE EXCEPTION 'Exception did not submit'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
  UPDATE public.clients SET first_name='Blocked edit' WHERE id=client;
  RAISE EXCEPTION 'Direct write bypass';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 BEGIN
  PERFORM public.append_session_note_remark(running,'Blocked remark',gen_random_uuid());
  RAISE EXCEPTION 'Remark bypass';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 BEGIN
  PERFORM public.mutate_session_note(running,'approve',n.version,gen_random_uuid(),null,null,null);
  RAISE EXCEPTION 'Review bypass';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 UPDATE public.users SET pin_hash='synthetic-reset' WHERE id=provider;
 BEGIN
  UPDATE public.clients SET first_name='Blocked service edit' WHERE id=client;
  RAISE EXCEPTION 'Server write bypass';
 EXCEPTION WHEN SQLSTATE 'P4020' THEN NULL; END;
 RESET ROLE;
 UPDATE rejoyce_security.organization_subscriptions SET paid_through=statement_timestamp()+interval '30 days' WHERE organization_id=org;
 SET LOCAL ROLE authenticated;
 UPDATE public.clients SET first_name='Paid edit' WHERE id=client;
 IF NOT (public.subscription_access()->>'canWrite')::boolean THEN RAISE EXCEPTION 'Paid access not restored'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 BEGIN
  PERFORM public.create_self_service_organization(owner_id,device,'X','Y','Z','Other');
  RAISE EXCEPTION 'Anonymous creation allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END;
$test$;
