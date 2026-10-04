-- Synthetic fixtures only. Every write is rolled back, including on assertions.
BEGIN;
DO $test$
DECLARE
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid();
 staff uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); device uuid:=gen_random_uuid();
 staff_device uuid:=gen_random_uuid(); outsider_device uuid:=gen_random_uuid(); client uuid;
 selected uuid; untouched uuid; version timestamptz; affected integer;
BEGIN
 INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic session editor'),(other_org,'Synthetic other editor');
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (manager,manager::text||'@example.invalid','{}'),(staff,staff::text||'@example.invalid','{}'),(outsider,outsider::text||'@example.invalid','{}');
 UPDATE public.users SET organization_id=org,role='manager',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=manager;
 UPDATE public.users SET organization_id=org,role='teacher',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=staff;
 UPDATE public.users SET organization_id=other_org,role='owner',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=outsider;
 INSERT INTO public.user_permissions(organization_id,user_id,can_manage_sessions) VALUES(org,manager,true);
 INSERT INTO auth.sessions(id,user_id,created_at) VALUES(device,manager,now()),(staff_device,staff,now()),(outsider_device,outsider,now());
 INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
 VALUES(device,manager,now(),now(),now()+interval '5 minutes'),(staff_device,staff,now(),now(),now()+interval '5 minutes'),(outsider_device,outsider,now(),now(),now()+interval '5 minutes');
 INSERT INTO public.clients(organization_id,first_name,assigned_provider_id) VALUES(org,'Synthetic client',staff) RETURNING id INTO client;
 INSERT INTO public.sessions(organization_id,client_id,provider_id,scheduled_start,scheduled_end,location)
 VALUES(org,client,staff,now()+interval '1 day',now()+interval '25 hours','Original') RETURNING id,updated_at INTO selected,version;
 INSERT INTO public.sessions(organization_id,client_id,provider_id,location) VALUES(org,client,staff,'Untouched') RETURNING id INTO untouched;
 PERFORM set_config('request.jwt.claim.sub',manager::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.sessions SET location='Saved by editor' WHERE id=selected AND organization_id=org AND updated_at=version;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR (SELECT location FROM public.sessions WHERE id=selected)<>'Saved by editor' THEN RAISE EXCEPTION 'Correct-record save failed'; END IF;
 IF (SELECT location FROM public.sessions WHERE id=untouched)<>'Untouched' THEN RAISE EXCEPTION 'Save touched another record'; END IF;
 UPDATE public.sessions SET location='Wrong organization' WHERE id=selected AND organization_id=other_org;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Organization filter bypassed'; END IF;
 UPDATE public.sessions SET location='Stale' WHERE id=selected AND updated_at=version-interval '1 second';
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Stale version accepted'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',staff_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.sessions SET location='Unauthorized staff' WHERE id=selected;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Staff write accepted'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',outsider_device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.sessions SET location='Cross tenant' WHERE id=selected;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Cross-tenant write accepted'; END IF;
 RESET ROLE;
 UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=device;
 PERFORM set_config('request.jwt.claim.sub',manager::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',device,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.sessions SET location='Locked device' WHERE id=selected;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'Locked-device write accepted'; END IF;
 RESET ROLE;
 UPDATE public.device_sessions SET unlocked_until=now()+interval '5 minutes' WHERE session_id=device;
 UPDATE public.sessions SET status='in_progress',started_at=now() WHERE id=selected;
 SET LOCAL ROLE authenticated;
 BEGIN
  UPDATE public.sessions SET scheduled_start=scheduled_start+interval '1 hour' WHERE id=selected;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Started-session schedule edit accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 -- Location/attendance remain editable after start under the existing rules.
 UPDATE public.sessions SET location='Allowed after start',attendance_status='present' WHERE id=selected;
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Allowed after-start edit failed'; END IF;
 RESET ROLE;
 UPDATE public.sessions SET status='completed',completed_at=now() WHERE id=selected;
 SET LOCAL ROLE authenticated;
 BEGIN
  UPDATE public.sessions SET location='Historical edit' WHERE id=selected;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Historical edit accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 RESET ROLE;
END;
$test$;
ROLLBACK;
