-- Groups are selection shortcuts only. Client access is granted by explicit people.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.clients ADD COLUMN care_team_version integer NOT NULL DEFAULT 0;

CREATE TABLE public.staff_locations (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (user_id, location_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES public.users(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (location_id, organization_id) REFERENCES public.organization_locations(id, organization_id)
);
CREATE TABLE public.care_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('team', 'class', 'group')),
  version integer NOT NULL DEFAULT 0,
  UNIQUE (id, organization_id),
  FOREIGN KEY (location_id, organization_id) REFERENCES public.organization_locations(id, organization_id)
);
CREATE TABLE public.care_group_members (
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, organization_id) REFERENCES public.care_groups(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, organization_id) REFERENCES public.users(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE public.client_care_members (
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (client_id, user_id),
  FOREIGN KEY (client_id, organization_id) REFERENCES public.clients(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, organization_id) REFERENCES public.users(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX ON public.staff_locations(organization_id, location_id);
CREATE INDEX ON public.care_groups(organization_id, location_id);
CREATE INDEX ON public.care_group_members(organization_id, user_id);
CREATE INDEX ON public.client_care_members(organization_id, user_id);

-- Preserve existing default-worker grants and branch attendance, without inferring
-- any new group membership or assigning additional people.
INSERT INTO public.staff_locations(organization_id, user_id, location_id)
SELECT DISTINCT c.organization_id, c.assigned_provider_id, cl.location_id
FROM public.clients c JOIN public.client_locations cl ON cl.client_id=c.id
WHERE c.assigned_provider_id IS NOT NULL;
INSERT INTO public.client_care_members(organization_id, client_id, user_id)
SELECT organization_id, id, assigned_provider_id FROM public.clients WHERE assigned_provider_id IS NOT NULL;

DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_locations','care_groups','care_group_members','client_care_members'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY require_unlocked_device ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT rejoyce_security.session_is_unlocked())) WITH CHECK ((SELECT rejoyce_security.session_is_unlocked()))', t);
    EXECUTE format('CREATE POLICY client_manager_read ON public.%I FOR SELECT TO authenticated USING (organization_id=(SELECT public.current_organization_id()) AND (SELECT public.can_manage_clients()))', t);
    EXECUTE format('CREATE TRIGGER zz_subscription_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_subscription_write()', t);
    EXECUTE format('CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.%I FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment()', t);
  END LOOP;
END;
$policies$;
CREATE POLICY own_assignment_read ON public.client_care_members FOR SELECT TO authenticated
USING (organization_id=(SELECT public.current_organization_id()) AND user_id=(SELECT auth.uid()));

CREATE FUNCTION rejoyce_security.is_care_member(p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT rejoyce_security.session_is_unlocked() AND EXISTS (
    SELECT 1 FROM public.client_care_members m
    JOIN public.users u ON u.id=m.user_id AND u.organization_id=m.organization_id
    WHERE m.client_id=p_client_id AND m.user_id=(SELECT auth.uid())
      AND m.organization_id=public.current_organization_id() AND u.status='active'
      AND EXISTS (SELECT 1 FROM public.client_locations cl
        JOIN public.staff_locations sl ON sl.location_id=cl.location_id AND sl.organization_id=cl.organization_id
        JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=cl.organization_id
        WHERE cl.client_id=m.client_id AND sl.user_id=m.user_id AND l.active)
  );
$fn$;
REVOKE ALL ON FUNCTION rejoyce_security.is_care_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.is_care_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_client(requested_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id=requested_client_id
      AND c.organization_id=public.current_organization_id()
      AND (public.can_manage_clients() OR public.can_manage_sessions()
        OR rejoyce_security.is_care_member(c.id)
        OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.client_id=c.id AND s.provider_id=auth.uid()))
  ) ELSE false END;
$fn$;

-- Serialize assignment/setup mutations within the business. All elevated writers
-- validate caller, tenant, unlocked device, subscription, and supplied IDs.
CREATE FUNCTION rejoyce_security.care_manager_org()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org:=public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_clients() THEN
    RAISE EXCEPTION 'You do not have permission to manage clients' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
  RETURN org;
END;
$fn$;

CREATE FUNCTION rejoyce_security.care_context(p_client_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; result jsonb;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org:=public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_clients() THEN
    RAISE EXCEPTION 'You do not have permission to manage clients' USING ERRCODE='42501';
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id AND organization_id=org) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.full_name,''),'Unnamed staff'),'role',u.role,'status',u.status,
      'location_ids',coalesce((SELECT jsonb_agg(sl.location_id ORDER BY sl.location_id) FROM public.staff_locations sl WHERE sl.user_id=u.id AND sl.organization_id=org),'[]'::jsonb)))
      FROM public.users u WHERE u.organization_id=org AND (u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff')
        OR EXISTS (SELECT 1 FROM public.client_care_members m WHERE m.client_id=p_client_id AND m.user_id=u.id))),'[]'::jsonb),
    'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'kind',g.kind,'location_id',g.location_id,'version',g.version,
      'member_ids',coalesce((SELECT jsonb_agg(m.user_id) FROM public.care_group_members m WHERE m.group_id=g.id),'[]'::jsonb)))
      FROM public.care_groups g WHERE g.organization_id=org),'[]'::jsonb),
    'location_ids',coalesce((SELECT jsonb_agg(location_id) FROM public.client_locations WHERE client_id=p_client_id),'[]'::jsonb),
    'member_ids',coalesce((SELECT jsonb_agg(user_id) FROM public.client_care_members WHERE client_id=p_client_id),'[]'::jsonb),
    'primary_id',(SELECT assigned_provider_id FROM public.clients WHERE id=p_client_id),
    'version',(SELECT care_team_version FROM public.clients WHERE id=p_client_id)
  ) INTO result;
  RETURN result;
END;
$fn$;

CREATE FUNCTION rejoyce_security.save_staff_locations(p_user_id uuid, p_location_ids uuid[], p_expected_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; current_ids uuid[]; desired uuid[];
BEGIN
  org:=rejoyce_security.care_manager_org();
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_user_id AND organization_id=org AND status='active'
    AND role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff')) THEN
    RAISE EXCEPTION 'Choose active care staff from your organization' USING ERRCODE='22023';
  END IF;
  IF p_location_ids IS NULL OR array_position(p_location_ids,NULL) IS NOT NULL OR p_expected_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid branch selection' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(location_id ORDER BY location_id),'{}') INTO current_ids FROM public.staff_locations WHERE user_id=p_user_id;
  IF current_ids IS DISTINCT FROM (SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') FROM unnest(p_expected_ids) id) THEN
    RAISE EXCEPTION 'Staff branches changed. Reload before saving.' USING ERRCODE='40001';
  END IF;
  SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO desired FROM unnest(p_location_ids) id;
  IF EXISTS (SELECT 1 FROM unnest(desired) picked(id) WHERE NOT EXISTS (SELECT 1 FROM public.organization_locations l
    WHERE l.id=picked.id AND l.organization_id=org AND (l.active OR l.id=ANY(current_ids)))) THEN
    RAISE EXCEPTION 'Choose active branches from your organization' USING ERRCODE='22023';
  END IF;
  -- Removing branch eligibility does not add/remove saved people or groups. It
  -- immediately removes this care-assignment access path if no branch is shared.
  DELETE FROM public.staff_locations WHERE user_id=p_user_id AND NOT(location_id=ANY(desired));
  INSERT INTO public.staff_locations SELECT org,p_user_id,id FROM unnest(desired) id ON CONFLICT DO NOTHING;
END;
$fn$;

CREATE FUNCTION rejoyce_security.save_care_group(p_id uuid,p_name text,p_kind text,p_location_id uuid,p_member_ids uuid[],p_expected_version integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; gid uuid; ver integer;
BEGIN
  org:=rejoyce_security.care_manager_org();
  IF nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>100 OR p_kind NOT IN ('team','class','group') OR p_kind IS NULL
    OR p_member_ids IS NULL OR array_position(p_member_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Enter a name, type, branch, and valid members' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_locations WHERE id=p_location_id AND organization_id=org AND active) THEN
    RAISE EXCEPTION 'Choose an active branch from your organization' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_member_ids) picked(id) WHERE NOT EXISTS (SELECT 1 FROM public.users u
    JOIN public.staff_locations sl ON sl.user_id=u.id AND sl.organization_id=u.organization_id
    WHERE u.id=picked.id AND u.organization_id=org AND u.status='active' AND sl.location_id=p_location_id
      AND u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff'))) THEN
    RAISE EXCEPTION 'Group members need active staff status and this branch in their setup' USING ERRCODE='22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.care_groups(organization_id,location_id,name,kind) VALUES(org,p_location_id,btrim(p_name),p_kind) RETURNING id INTO gid;
  ELSE
    SELECT version INTO ver FROM public.care_groups WHERE id=p_id AND organization_id=org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found' USING ERRCODE='42501'; END IF;
    IF ver IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Group changed. Reload before saving.' USING ERRCODE='40001'; END IF;
    gid:=p_id;
    UPDATE public.care_groups SET name=btrim(p_name),kind=p_kind,location_id=p_location_id,version=version+1 WHERE id=gid;
    DELETE FROM public.care_group_members WHERE group_id=gid;
  END IF;
  INSERT INTO public.care_group_members SELECT DISTINCT org,gid,id FROM unnest(p_member_ids) id;
  RETURN gid;
END;
$fn$;

CREATE FUNCTION rejoyce_security.set_client_care_team(p_client_id uuid,p_member_ids uuid[],p_primary_id uuid,p_expected_version integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; ver integer; desired uuid[];
BEGIN
  org:=rejoyce_security.care_manager_org();
  SELECT care_team_version INTO ver FROM public.clients WHERE id=p_client_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found' USING ERRCODE='42501'; END IF;
  IF ver IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Care team changed. Reload before saving.' USING ERRCODE='40001'; END IF;
  IF p_member_ids IS NULL OR array_position(p_member_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid care-team selection' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO desired FROM unnest(p_member_ids) id;
  IF p_primary_id IS NOT NULL AND NOT(p_primary_id=ANY(desired)) THEN
    RAISE EXCEPTION 'The default worker must be selected in the care team' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(desired) picked(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.users u JOIN public.staff_locations sl ON sl.user_id=u.id AND sl.organization_id=u.organization_id
    JOIN public.client_locations cl ON cl.location_id=sl.location_id AND cl.organization_id=sl.organization_id
    JOIN public.organization_locations l ON l.id=sl.location_id
    WHERE u.id=picked.id AND u.organization_id=org AND u.status='active' AND cl.client_id=p_client_id AND l.active
      AND u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff'))) THEN
    RAISE EXCEPTION 'Selected staff must be active and share an active client branch. Update setup or remove unavailable people.' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.client_care_members WHERE client_id=p_client_id AND NOT(user_id=ANY(desired));
  INSERT INTO public.client_care_members SELECT org,p_client_id,id FROM unnest(desired) id ON CONFLICT DO NOTHING;
  UPDATE public.clients SET assigned_provider_id=p_primary_id,care_team_version=care_team_version+1 WHERE id=p_client_id RETURNING care_team_version INTO ver;
  RETURN ver;
END;
$fn$;

CREATE FUNCTION rejoyce_security.create_client_with_care_team(p_first_name text,p_last_name text,p_preferred_name text,p_location_ids uuid[],p_member_ids uuid[],p_primary_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid; cid uuid;
BEGIN
  org:=rejoyce_security.care_manager_org();
  IF nullif(btrim(p_first_name),'') IS NULL THEN RAISE EXCEPTION 'A first name is required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.clients(organization_id,first_name,last_name,preferred_name,status)
    VALUES(org,btrim(p_first_name),nullif(btrim(p_last_name),''),nullif(btrim(p_preferred_name),''),'active') RETURNING id INTO cid;
  PERFORM public.set_client_locations(cid,p_location_ids);
  PERFORM rejoyce_security.set_client_care_team(cid,p_member_ids,p_primary_id,0);
  RETURN cid;
END;
$fn$;

-- Existing primary-worker API cannot grant care access or bypass branch setup.
CREATE FUNCTION rejoyce_security.check_care_primary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF NEW.assigned_provider_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assigned_provider_id IS DISTINCT FROM OLD.assigned_provider_id)
    AND NOT EXISTS (SELECT 1 FROM public.client_care_members m WHERE m.client_id=NEW.id AND m.user_id=NEW.assigned_provider_id AND m.organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Save the default worker through the care-team selector' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_care_primary BEFORE INSERT OR UPDATE OF assigned_provider_id ON public.clients
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.check_care_primary();

-- Public wrappers use caller rights; elevated helpers live in the unexposed schema.
CREATE FUNCTION public.care_context(p_client_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.care_context(p_client_id) $$;
CREATE FUNCTION public.save_staff_locations(p_user_id uuid,p_location_ids uuid[],p_expected_ids uuid[]) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_staff_locations(p_user_id,p_location_ids,p_expected_ids) $$;
CREATE FUNCTION public.save_care_group(p_id uuid,p_name text,p_kind text,p_location_id uuid,p_member_ids uuid[],p_expected_version integer) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_care_group(p_id,p_name,p_kind,p_location_id,p_member_ids,p_expected_version) $$;
CREATE FUNCTION public.set_client_care_team(p_client_id uuid,p_member_ids uuid[],p_primary_id uuid,p_expected_version integer) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.set_client_care_team(p_client_id,p_member_ids,p_primary_id,p_expected_version) $$;
CREATE FUNCTION public.create_client_with_care_team(p_first_name text,p_last_name text,p_preferred_name text,p_location_ids uuid[],p_member_ids uuid[],p_primary_id uuid) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.create_client_with_care_team(p_first_name,p_last_name,p_preferred_name,p_location_ids,p_member_ids,p_primary_id) $$;
CREATE OR REPLACE FUNCTION public.create_client_with_locations(p_first_name text,p_last_name text,p_preferred_name text,p_assigned_provider_id uuid,p_location_ids uuid[])
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.create_client_with_care_team(p_first_name,p_last_name,p_preferred_name,p_location_ids,CASE WHEN p_assigned_provider_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_assigned_provider_id] END,p_assigned_provider_id) $$;

DO $grants$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','rejoyce_security') AND p.proname IN ('care_manager_org','care_context','save_staff_locations','save_care_group','set_client_care_team','create_client_with_care_team','check_care_primary') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    IF f.signature::text NOT LIKE '%check_care_primary%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END;
$grants$;
