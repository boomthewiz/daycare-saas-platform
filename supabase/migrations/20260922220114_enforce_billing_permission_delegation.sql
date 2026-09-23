-- Enforce the existing People UI rule: only owners/admins change billing grants.
-- Existing RLS still decides which organization and target accounts can be managed.
CREATE OR REPLACE FUNCTION rejoyce_security.guard_billing_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  changes_billing boolean;
BEGIN
  -- Trusted server/database maintenance retains its existing authority.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    changes_billing := coalesce(NEW.can_manage_billing, false);
  ELSE
    changes_billing :=
      coalesce(NEW.can_manage_billing, false) IS DISTINCT FROM coalesce(OLD.can_manage_billing, false)
      OR (
        (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
        AND (coalesce(NEW.can_manage_billing, false) OR coalesce(OLD.can_manage_billing, false))
      );
  END IF;

  IF changes_billing AND (
    auth.uid() IS NULL
    OR NOT coalesce(public.current_user_role() IN ('owner', 'admin'), false)
  ) THEN
    RAISE EXCEPTION 'Only owners and administrators can change billing permissions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION rejoyce_security.guard_billing_permission() FROM PUBLIC, anon, authenticated;
-- AFTER runs only for the actual INSERT or UPDATE arm of an upsert.
-- This permits unchanged billing grants when managers save other permissions.
CREATE TRIGGER guard_billing_permission
AFTER INSERT OR UPDATE ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_billing_permission();
