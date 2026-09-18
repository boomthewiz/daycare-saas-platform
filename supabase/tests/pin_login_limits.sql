BEGIN;
DO $test$
DECLARE
  k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  other_k text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  r record;
  successful_id uuid;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.reserve_pin_login_attempt(k);
    RAISE EXCEPTION 'Anonymous RPC access permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.reserve_pin_login_attempt(k);
    RAISE EXCEPTION 'Authenticated RPC access permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.pin_login_attempts WHERE account_key=k;
    RAISE EXCEPTION 'Browser can clear attempts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
    IF NOT r.allowed OR r.attempt_id IS NULL THEN RAISE EXCEPTION 'Initial attempt rejected'; END IF;
    successful_id := r.attempt_id;
  END LOOP;
  SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
  IF r.allowed OR r.retry_after NOT BETWEEN 890 AND 900 THEN RAISE EXCEPTION 'Short window not enforced'; END IF;
  SELECT * INTO r FROM public.reserve_pin_login_attempt(other_k);
  IF NOT r.allowed THEN RAISE EXCEPTION 'Independent account blocked'; END IF;
  DELETE FROM public.pin_login_attempts WHERE id=successful_id AND account_key=k;
  SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
  IF NOT r.allowed THEN RAISE EXCEPTION 'Successful attempt not released'; END IF;
  RESET ROLE;
  UPDATE public.pin_login_attempts SET created_at=clock_timestamp()-interval '16 minutes' WHERE account_key=k;
  SET LOCAL ROLE service_role;
  SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
  IF NOT r.allowed THEN RAISE EXCEPTION 'Short window did not expire'; END IF;
  DELETE FROM public.pin_login_attempts WHERE account_key=k;
  INSERT INTO public.pin_login_attempts(account_key,created_at)
    SELECT k,clock_timestamp()-interval '1 hour' FROM generate_series(1,20);
  SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
  IF r.allowed OR r.retry_after NOT BETWEEN 82790 AND 82800 THEN RAISE EXCEPTION 'Daily limit not enforced'; END IF;
  RESET ROLE;
  UPDATE public.pin_login_attempts SET created_at=clock_timestamp()-interval '25 hours' WHERE account_key=k;
  SET LOCAL ROLE service_role;
  SELECT * INTO r FROM public.reserve_pin_login_attempt(k);
  IF NOT r.allowed THEN RAISE EXCEPTION 'Daily window did not expire'; END IF;
  RESET ROLE;
END
$test$;
ROLLBACK;
SELECT 'PASS: server-only access, five-attempt window, daily cap, success release, independent accounts and expiry' AS result;
