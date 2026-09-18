-- Apply before deploying the route. Only the trusted server may reserve attempts.
CREATE TABLE public.pin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL CHECK (account_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pin_login_attempts_account_time ON public.pin_login_attempts(account_key, created_at);
CREATE INDEX pin_login_attempts_expiry ON public.pin_login_attempts(created_at);
ALTER TABLE public.pin_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pin_login_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.pin_login_attempts TO service_role;
CREATE POLICY server_only ON public.pin_login_attempts TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.reserve_pin_login_attempt(p_account_key text)
RETURNS TABLE(allowed boolean, retry_after integer, attempt_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '3s'
AS $function$
DECLARE
  checked_at timestamptz;
  short_count integer;
  daily_count integer;
  short_first timestamptz;
  daily_first timestamptz;
  wait_seconds integer := 0;
  reserved_id uuid;
BEGIN
  IF p_account_key IS NULL OR p_account_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid account key' USING ERRCODE = '22023';
  END IF;
  -- Serialize admission, not the expensive bcrypt comparison. Pending attempts
  -- count as failures until success removes that exact reservation.
  PERFORM pg_advisory_xact_lock(hashtextextended('pin-login:' || p_account_key, 0));
  checked_at := clock_timestamp();
  SELECT count(*) FILTER (WHERE created_at > checked_at - interval '15 minutes'),
         count(*),
         min(created_at) FILTER (WHERE created_at > checked_at - interval '15 minutes'),
         min(created_at)
    INTO short_count, daily_count, short_first, daily_first
    FROM public.pin_login_attempts
    WHERE account_key = p_account_key AND created_at > checked_at - interval '24 hours';
  IF short_count >= 5 THEN
    wait_seconds := greatest(1, ceil(extract(epoch FROM short_first + interval '15 minutes' - checked_at))::integer);
  END IF;
  IF daily_count >= 20 THEN
    wait_seconds := greatest(wait_seconds, 1, ceil(extract(epoch FROM daily_first + interval '24 hours' - checked_at))::integer);
  END IF;
  IF wait_seconds > 0 THEN
    RETURN QUERY SELECT false, wait_seconds, NULL::uuid;
    RETURN;
  END IF;
  -- Bounded opportunistic cleanup; active attempts are never deleted here.
  DELETE FROM public.pin_login_attempts WHERE id IN (
    SELECT id FROM public.pin_login_attempts
    WHERE created_at <= checked_at - interval '24 hours'
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO public.pin_login_attempts(account_key, created_at)
    VALUES (p_account_key, checked_at) RETURNING id INTO reserved_id;
  RETURN QUERY SELECT true, 0, reserved_id;
END
$function$;
REVOKE ALL ON FUNCTION public.reserve_pin_login_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_pin_login_attempt(text) TO service_role;
NOTIFY pgrst, 'reload schema';
