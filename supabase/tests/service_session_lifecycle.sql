-- Run after the migration in a transaction. Synthetic fixtures only; no emails.
BEGIN;
DO $test$
DECLARE
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); provider uuid:=gen_random_uuid();
 reviewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); device uuid:=gen_random_uuid();
 review_device uuid:=gen_random_uuid(); outsider_device uuid:=gen_random_uuid();
 client uuid; session uuid; target uuid; second_target uuid; n public.session_notes%rowtype; before_note jsonb; finished_at timestamptz;
 op uuid; c integer; affected integer; actor_role text; r public.session_note_remarks%rowtype;
BEGIN
 INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic workflow'),(other_org,'Synthetic other tenant');
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (provider,provider::text||'@example.invalid','{}'),(reviewer,reviewer::text||'@example.invalid','{}'),(outsider,outsider::text||'@example.invalid','{}');
 UPDATE public.users SET organization_id=org,role='teacher',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=provider;
 UPDATE public.users SET organization_id=org,role='manager',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=reviewer;
 UPDATE public.users SET organization_id=other_org,role='owner',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=outsider;
 INSERT INTO auth.sessions(id,user_id,created_at) VALUES(device,provider,now()),(review_device,reviewer,now()),(outsider_device,outsider,now());
 INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
 VALUES(device,provider,now(),now(),now()+interval '5 minutes'),(review_device,reviewer,now(),now(),now()+interval '5 minutes'),(outsider_device,outsider,now(),now(),now()+interval '5 minutes');
 INSERT INTO public.user_permissions(organization_id,user_id,can_manage_sessions,can_review_sessions) VALUES(org,reviewer,true,true);
 INSERT INTO public.clients(organization_id,first_name,assigned_provider_id) VALUES(org,'Synthetic client',provider) RETURNING id INTO client;
 INSERT INTO public.sessions(organization_id,client_id,provider_id) VALUES(org,client,provider) RETURNING id INTO session;
 INSERT INTO public.session_targets(organization_id,session_id,title) VALUES(org,session,'Synthetic target') RETURNING id INTO target;
 INSERT INTO public.session_targets(organization_id,session_id,title,sort_order) VALUES(org,session,'Second target',1) RETURNING id INTO second_target;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'session_id',review_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.swap_session_targets(session,target,second_target,0,1);
 IF (SELECT sort_order FROM public.session_targets WHERE id=target)<>1 THEN RAISE EXCEPTION 'Atomic target swap failed'; END IF;
 BEGIN
   PERFORM public.swap_session_targets(session,target,second_target,0,1);
   RAISE EXCEPTION 'Stale target reorder accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
   UPDATE public.sessions SET status='completed' WHERE id=session;
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Direct completion bypass accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',provider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',provider,'session_id',device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
   PERFORM public.mutate_session_note(session,'save',0,gen_random_uuid(),'Too early',null,null);
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Scheduled draft accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 PERFORM public.start_assigned_session(session);
 n:=public.mutate_session_note(session,'save',0,gen_random_uuid(),'Initial draft','During service',null);
 IF n.version<>1 OR n.status<>'draft' THEN RAISE EXCEPTION 'Initial draft invalid'; END IF;
 BEGIN
   PERFORM public.mutate_session_note(session,'submit',n.version,gen_random_uuid(),'Premature submission',null,null);
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Active submission accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 IF (SELECT final_note FROM public.session_notes WHERE id=n.id)<>'Initial draft' THEN RAISE EXCEPTION 'Failed submit modified draft'; END IF;
 PERFORM public.pause_assigned_session(session);
 BEGIN
   PERFORM public.start_assigned_session(session);
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Start bypassed pause accounting';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 n:=public.mutate_session_note(session,'save',n.version,gen_random_uuid(),'Paused draft','Paused observations',null);
 PERFORM public.resume_assigned_session(session);
 PERFORM public.record_target_response(target,'independent',null,null);
 PERFORM public.finish_assigned_session(session);
 SELECT completed_at INTO finished_at FROM public.sessions WHERE id=session;
 PERFORM public.finish_assigned_session(session);
 IF (SELECT completed_at FROM public.sessions WHERE id=session) IS DISTINCT FROM finished_at THEN RAISE EXCEPTION 'Finish retry reset completion time'; END IF;
 BEGIN
   PERFORM public.record_target_response(target,'independent',null,null);
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Post-completion data accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 BEGIN
   PERFORM public.mutate_session_note(session,'save',1,gen_random_uuid(),'Stale draft',null,null);
   RAISE EXCEPTION 'Stale edit accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 op:=gen_random_uuid();
 n:=public.mutate_session_note(session,'submit',2,op,'Final submitted text','Observations',null);
 IF n.status<>'submitted' OR n.version<>3 THEN RAISE EXCEPTION 'Submit invalid'; END IF;
 n:=public.mutate_session_note(session,'submit',2,op,'Final submitted text','Observations',null);
 SELECT count(*) INTO c FROM public.session_note_history WHERE operation_id=op;
 IF c<>1 OR n.version<>3 THEN RAISE EXCEPTION 'Retry duplicated write'; END IF;
 BEGIN
   PERFORM public.mutate_session_note(session,'submit',2,op,'Changed retry',null,null);
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Reused key with changed body accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 BEGIN
   PERFORM public.save_assigned_session_note_draft(session,'Legacy bypass','Legacy bypass');
   RAISE EXCEPTION 'Legacy note write remained callable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.session_notes SET final_note='Direct bypass' WHERE id=n.id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Direct note write accepted'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'session_id',review_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
   PERFORM public.mutate_session_note(session,'return',n.version,gen_random_uuid(),null,null,' ');
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Blank return accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 n:=public.mutate_session_note(session,'return',n.version,gen_random_uuid(),null,null,'Clarify observations');
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',provider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',provider,'session_id',device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 n:=public.mutate_session_note(session,'save',n.version,gen_random_uuid(),'Corrected text','Corrected observations',null);
 IF n.status<>'returned' OR n.review_notes<>'Clarify observations' THEN RAISE EXCEPTION 'Feedback lost during correction'; END IF;
 n:=public.mutate_session_note(session,'submit',n.version,gen_random_uuid(),'Corrected text','Corrected observations',null);
 IF n.reviewed_at IS NOT NULL OR n.reviewed_by IS NOT NULL OR n.review_notes IS NOT NULL THEN RAISE EXCEPTION 'Stale review metadata after resubmit'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'session_id',review_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 n:=public.mutate_session_note(session,'approve',n.version,gen_random_uuid(),null,null,'Reviewed');
 BEGIN
   PERFORM public.mutate_session_note(session,'return',n.version,gen_random_uuid(),null,null,'Cannot return approved');
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Approved return accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 BEGIN
   PERFORM public.mutate_session_note(session,'revert_approval',n.version,gen_random_uuid(),null,null,null);
   RAISE EXCEPTION 'Non-admin reverted approval';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 n:=public.mutate_session_note(session,'lock',n.version,gen_random_uuid(),null,null,null);
 IF n.locked_from_status<>'approved' THEN RAISE EXCEPTION 'Prior approval lost'; END IF;
 BEGIN
   PERFORM public.mutate_session_note(session,'unlock',n.version,gen_random_uuid(),null,null,null);
   RAISE EXCEPTION 'Non-admin unlocked';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.append_session_note_remark(session,'Forbidden remark',gen_random_uuid());
   RAISE EXCEPTION 'Non-admin appended remark';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   UPDATE public.sessions SET status='in_progress',completed_at=null WHERE id=session;
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Manager reopened historical service';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 BEGIN
   UPDATE public.session_targets SET title='Tampered' WHERE id=target;
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Manager changed historical target';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 RESET ROLE;
 FOREACH actor_role IN ARRAY ARRAY['admin','owner'] LOOP
   UPDATE public.users SET role=actor_role WHERE id=reviewer;
   UPDATE public.user_permissions SET can_review_sessions=false WHERE user_id=reviewer;
   SET LOCAL ROLE authenticated;
   SELECT to_jsonb(sn) INTO before_note FROM public.session_notes sn WHERE id=n.id;
   op:=gen_random_uuid();
   r:=public.append_session_note_remark(session,'Separate administrator remark',op);
   r:=public.append_session_note_remark(session,'Separate administrator remark',op);
   IF before_note IS DISTINCT FROM (SELECT to_jsonb(sn) FROM public.session_notes sn WHERE id=n.id) THEN RAISE EXCEPTION 'Remark altered note or timestamps'; END IF;
   SELECT count(*) INTO c FROM public.session_note_remarks WHERE operation_id=op;
   IF c<>1 THEN RAISE EXCEPTION 'Remark retry duplicated'; END IF;
   BEGIN
     UPDATE public.session_note_remarks SET body='changed' WHERE id=r.id;
     RAISE EXCEPTION 'Remark update accepted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   n:=public.mutate_session_note(session,'unlock',n.version,gen_random_uuid(),null,null,null);
   IF n.status<>'approved' THEN RAISE EXCEPTION 'Unlock failed to restore approval'; END IF;
   n:=public.mutate_session_note(session,'revert_approval',n.version,gen_random_uuid(),null,null,null);
   RESET ROLE;
   UPDATE public.user_permissions SET can_review_sessions=true WHERE user_id=reviewer;
   SET LOCAL ROLE authenticated;
   n:=public.mutate_session_note(session,'lock',n.version,gen_random_uuid(),null,null,null);
   IF n.locked_from_status<>'submitted' THEN RAISE EXCEPTION 'Unapproved lock status lost'; END IF;
   n:=public.mutate_session_note(session,'unlock',n.version,gen_random_uuid(),null,null,null);
   IF n.status<>'submitted' THEN RAISE EXCEPTION 'Unlock wrongly approved note'; END IF;
   n:=public.mutate_session_note(session,'approve',n.version,gen_random_uuid(),null,null,null);
   n:=public.mutate_session_note(session,'lock',n.version,gen_random_uuid(),null,null,null);
   RESET ROLE;
 END LOOP;
 -- Cross-tenant privileged roles cannot view history or mutate records.
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',outsider_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.session_note_history WHERE session_id=session) OR EXISTS(SELECT 1 FROM public.session_note_remarks WHERE session_id=session) THEN RAISE EXCEPTION 'Cross-tenant history leaked'; END IF;
 BEGIN
   PERFORM public.mutate_session_note(session,'unlock',n.version,gen_random_uuid(),null,null,null);
   RAISE EXCEPTION 'Cross-tenant unlock allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.append_session_note_remark(session,'Foreign remark',gen_random_uuid());
   RAISE EXCEPTION 'Cross-tenant remark allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 -- Locked devices cannot read the new tables or invoke writes.
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'session_id',review_device,'role','authenticated')::text,true);
 UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=review_device;
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.session_note_history WHERE session_id=session) THEN RAISE EXCEPTION 'Locked device saw history'; END IF;
 BEGIN
   PERFORM public.append_session_note_remark(session,'Locked device',gen_random_uuid());
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Locked device wrote remark';
 EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'P0001' THEN NULL; END;
 RESET ROLE;
 SET LOCAL ROLE anon;
 BEGIN
   PERFORM public.mutate_session_note(session,'unlock',n.version,gen_random_uuid(),null,null,null);
   RAISE EXCEPTION 'Anonymous call allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END;
$test$;
ROLLBACK;
SELECT 'PASS: service lifecycle, author/reviewer/admin authority, atomic submission, stale versions, safe retries, feedback, history, immutable remarks, tenant and device boundaries' AS result;
