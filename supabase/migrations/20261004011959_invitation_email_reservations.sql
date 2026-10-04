-- Draft for review. Apply before deploying the route; missing RPCs fail closed.
-- Private storage, service-role-only invoker RPCs, no browser grants.
CREATE TABLE rejoyce_security.invitation_email_reservations (
  key text PRIMARY KEY CHECK (key = 'project' OR key ~ '^[a-f0-9]{64}$'),
  retry_at timestamptz NOT NULL
);
ALTER TABLE rejoyce_security.invitation_email_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.invitation_email_reservations FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA rejoyce_security TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON rejoyce_security.invitation_email_reservations TO service_role;
CREATE POLICY service_only ON rejoyce_security.invitation_email_reservations
  TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.reserve_invitation_email(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  at_time timestamptz;
  project_retry timestamptz;
  recipient_retry timestamptz;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid reservation key';
  END IF;
  INSERT INTO rejoyce_security.invitation_email_reservations(key,retry_at)
    VALUES('project','-infinity') ON CONFLICT DO NOTHING;
  -- Lock the shared project row first in both RPCs. This serializes claims
  -- across instances and recipients, including concurrent invite/resend.
  SELECT retry_at INTO project_retry FROM rejoyce_security.invitation_email_reservations
    WHERE key='project' FOR UPDATE;
  at_time := clock_timestamp();
  IF project_retry > at_time THEN
    RETURN jsonb_build_object('allowed',false,'project',true,
      'retry_after',ceil(extract(epoch FROM project_retry-at_time)));
  END IF;
  INSERT INTO rejoyce_security.invitation_email_reservations(key,retry_at)
    VALUES(p_key,'-infinity') ON CONFLICT DO NOTHING;
  SELECT retry_at INTO recipient_retry FROM rejoyce_security.invitation_email_reservations
    WHERE key=p_key FOR UPDATE;
  IF recipient_retry > at_time THEN
    RETURN jsonb_build_object('allowed',false,'project',false,
      'retry_after',ceil(extract(epoch FROM recipient_retry-at_time)));
  END IF;
  UPDATE rejoyce_security.invitation_email_reservations SET retry_at=at_time+interval '10 minutes'
    WHERE key=p_key;
  DELETE FROM rejoyce_security.invitation_email_reservations WHERE key IN (
    SELECT key FROM rejoyce_security.invitation_email_reservations
      WHERE key <> 'project' AND retry_at < at_time-interval '1 day'
      ORDER BY retry_at LIMIT 100
  );
  RETURN jsonb_build_object('allowed',true);
END
$fn$;

CREATE FUNCTION public.defer_invitation_email(p_key text, p_project boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE at_time timestamptz;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR p_project IS NULL THEN
    RAISE EXCEPTION 'Invalid reservation';
  END IF;
  PERFORM 1 FROM rejoyce_security.invitation_email_reservations WHERE key='project' FOR UPDATE;
  at_time := clock_timestamp();
  IF p_project THEN
    UPDATE rejoyce_security.invitation_email_reservations
      SET retry_at=greatest(retry_at,at_time+interval '1 hour') WHERE key='project';
  END IF;
  UPDATE rejoyce_security.invitation_email_reservations
    SET retry_at=greatest(retry_at,at_time+interval '10 minutes') WHERE key=p_key;
END
$fn$;
REVOKE ALL ON FUNCTION public.reserve_invitation_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_invitation_email(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_invitation_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_invitation_email(text,boolean) TO service_role;
