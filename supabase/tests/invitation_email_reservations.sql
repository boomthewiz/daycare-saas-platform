-- Run in the same transaction as the draft SQL, then ROLLBACK.
DO $test$
DECLARE r jsonb;
BEGIN
  IF has_function_privilege('anon','public.reserve_invitation_email(text)','execute')
    OR has_function_privilege('authenticated','public.defer_invitation_email(text,boolean)','execute')
    OR has_table_privilege('authenticated','rejoyce_security.invitation_email_reservations','select')
  THEN RAISE EXCEPTION 'Browser privilege leak'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='rejoyce_security.invitation_email_reservations'::regclass)
  THEN RAISE EXCEPTION 'RLS missing'; END IF;
  r := public.reserve_invitation_email(repeat('a',64));
  IF r->>'allowed' <> 'true' THEN RAISE EXCEPTION 'First claim denied'; END IF;
  r := public.reserve_invitation_email(repeat('a',64));
  IF r->>'allowed' <> 'false' OR (r->>'retry_after')::int NOT BETWEEN 599 AND 600
  THEN RAISE EXCEPTION 'Duplicate claim allowed'; END IF;
  r := public.reserve_invitation_email(repeat('b',64));
  IF r->>'allowed' <> 'true' THEN RAISE EXCEPTION 'Other recipient blocked'; END IF;
  PERFORM public.defer_invitation_email(repeat('a',64),true);
  r := public.reserve_invitation_email(repeat('c',64));
  IF r->>'allowed' <> 'false' OR r->>'project' <> 'true' OR (r->>'retry_after')::int NOT BETWEEN 3599 AND 3600
  THEN RAISE EXCEPTION 'Project backoff missing'; END IF;
  UPDATE rejoyce_security.invitation_email_reservations SET retry_at=clock_timestamp()-interval '1 second';
  r := public.reserve_invitation_email(repeat('a',64));
  IF r->>'allowed' <> 'true' THEN RAISE EXCEPTION 'Expired claim blocked'; END IF;
END
$test$;
