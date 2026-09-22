-- Owners/admins explicitly decide who may edit other users' permission grants.
ALTER TABLE public.user_permissions
  ADD COLUMN can_delegate_permissions boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_permissions.can_delegate_permissions IS
  'Owner/admin-controlled permission to edit nonbilling grants; also requires can_manage_users.';

CREATE OR REPLACE FUNCTION rejoyce_security.guard_permission_delegation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  allowed boolean;
  changes_delegation boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  PERFORM rejoyce_security.require_unlocked();

  -- Existing RLS still requires Manage users for non-owner administrators.
  IF coalesce(public.current_user_role() IN ('owner', 'admin'), false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    changes_delegation := NEW.can_delegate_permissions;
  ELSE
    changes_delegation :=
      NEW.can_delegate_permissions IS DISTINCT FROM OLD.can_delegate_permissions
      OR (
        (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
        AND (NEW.can_delegate_permissions OR OLD.can_delegate_permissions)
      );
  END IF;

  IF changes_delegation THEN
    RAISE EXCEPTION 'Only owners and administrators can change permission delegation'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(p.can_manage_users AND p.can_delegate_permissions, false)
  INTO allowed
  FROM public.user_permissions AS p
  WHERE p.user_id = auth.uid()
    AND p.organization_id = public.current_organization_id();

  IF NOT coalesce(allowed, false) THEN
    RAISE EXCEPTION 'An owner or administrator must allow you to delegate permissions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION rejoyce_security.guard_permission_delegation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_permission_delegation
AFTER INSERT OR UPDATE ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_permission_delegation();
