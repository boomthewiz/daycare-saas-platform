-- Activate the reviewed session policy after production email/PIN verification.
DO $activation$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rejoyce_security.session_policy WHERE singleton) THEN
    RAISE EXCEPTION 'Session policy must be staged before activation';
  END IF;
  UPDATE rejoyce_security.session_policy SET enforced=true WHERE singleton;
END
$activation$;
