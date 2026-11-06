BEGIN;
-- A release operator must not impersonate a customer to initialize the approved zone.
CREATE TABLE rejoyce_security.scheduling_timezone_bootstraps (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 timezone text NOT NULL, approval_reference text NOT NULL CHECK(length(btrim(approval_reference)) BETWEEN 3 AND 200),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE rejoyce_security.scheduling_timezone_bootstraps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.scheduling_timezone_bootstraps FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_timezone_bootstrap BEFORE UPDATE OR DELETE OR TRUNCATE ON rejoyce_security.scheduling_timezone_bootstraps
FOR EACH STATEMENT EXECUTE FUNCTION rejoyce_security.reject_support_audit_change();

ALTER TABLE rejoyce_security.scheduling_timezone_settings ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE rejoyce_security.scheduling_timezone_history ALTER COLUMN actor_id DROP NOT NULL;
CREATE FUNCTION rejoyce_security.guard_timezone_bootstrap_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb:=to_jsonb(NEW); actor text;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME='scheduling_timezone_settings' THEN row_data->>'updated_by' ELSE row_data->>'actor_id' END;
 IF actor IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.version<>1 OR (TG_TABLE_NAME='scheduling_timezone_history' AND row_data->>'previous_timezone' IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM rejoyce_security.scheduling_timezone_bootstraps b
 WHERE b.organization_id=NEW.organization_id AND b.timezone=NEW.timezone) THEN
  RAISE EXCEPTION 'Approved initial timezone bootstrap evidence required' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER timezone_bootstrap_provenance BEFORE INSERT OR UPDATE ON rejoyce_security.scheduling_timezone_settings
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_timezone_bootstrap_provenance();
CREATE TRIGGER timezone_bootstrap_provenance BEFORE INSERT OR UPDATE ON rejoyce_security.scheduling_timezone_history
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_timezone_bootstrap_provenance();
REVOKE ALL ON FUNCTION rejoyce_security.guard_timezone_bootstrap_provenance() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
