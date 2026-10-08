BEGIN;

-- Session managers can lack user-management access. Return only readiness,
-- never staff records, so a restricted list is not mistaken for an empty
-- business. The private definer requires organization-wide count visibility.
CREATE FUNCTION rejoyce_security.session_people_readiness()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE org uuid;
BEGIN
  org:=public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management permission required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'missing_clients',NOT EXISTS(SELECT 1 FROM public.clients WHERE organization_id=org AND status='active'),
    'missing_staff',NOT EXISTS(SELECT 1 FROM public.users WHERE organization_id=org AND status='active' AND role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff'))
  );
END;
$fn$;
CREATE FUNCTION public.session_people_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.session_people_readiness() $$;
REVOKE ALL ON FUNCTION rejoyce_security.session_people_readiness(), public.session_people_readiness() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.session_people_readiness(), public.session_people_readiness() TO authenticated;

-- Existing terminology RLS, unlocked-device policy and subscription trigger also
-- protect the theme. Keep current appearance for all existing businesses.
ALTER TABLE public.organization_terminology ADD COLUMN portal_theme text NOT NULL DEFAULT 'rejoyce'
  CHECK (portal_theme IN ('rejoyce','ocean','lavender'));
ALTER TABLE public.clients ADD COLUMN import_external_id text
  CHECK (import_external_id IS NULL OR (length(import_external_id) BETWEEN 1 AND 200 AND import_external_id=btrim(import_external_id)));
CREATE UNIQUE INDEX clients_import_external_id_unique ON public.clients(organization_id,import_external_id)
  WHERE import_external_id IS NOT NULL;

-- Invoker wrapper: every operation retains existing device, subscription, tenant
-- and client-management enforcement. The batch is atomic and repeat-safe.
CREATE FUNCTION public.import_clients(p_rows jsonb,p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE org uuid; item jsonb; cid uuid; external_id text; output jsonb := '[]';
BEGIN
  org := public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_clients() THEN
    RAISE EXCEPTION 'Unlock your session and obtain Manage clients permission before importing' USING ERRCODE='42501';
  END IF;
  -- Also reject skipped-only batches on expired subscriptions.
  IF (public.subscription_access()->>'canWrite')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Organization editing is unavailable with read-only access' USING ERRCODE='P4020';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Provide a list of people' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Import between 1 and 100 people' USING ERRCODE='22023'; END IF;
  IF p_location_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.organization_locations WHERE id=p_location_id AND organization_id=org AND active) THEN
    RAISE EXCEPTION 'Choose an active branch in your business' USING ERRCODE='22023';
  END IF;
  -- Serialize imports for this organization to avoid two simultaneous batches
  -- creating the same external ID between the existence check and INSERT.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(org::text,0));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'external_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'External IDs must be unique within the file' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid person record' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) key WHERE key NOT IN ('external_id','first_name','last_name','preferred_name')) THEN
      RAISE EXCEPTION 'Unsupported import field' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(item) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string'
      OR length(e.value #>> '{}')>200 OR (e.value #>> '{}') ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION 'Import values must be text of at most 200 characters without control characters' USING ERRCODE='22023';
    END IF;
    external_id:=nullif(btrim(item->>'external_id'),'');
    IF external_id IS NULL OR nullif(btrim(item->>'first_name'),'') IS NULL THEN
      RAISE EXCEPTION 'External ID and first name are required' USING ERRCODE='22023';
    END IF;
    SELECT id INTO cid FROM public.clients WHERE organization_id=org AND import_external_id=external_id;
    IF cid IS NOT NULL THEN
      output:=output||jsonb_build_array(jsonb_build_object('external_id',external_id,'status','skipped'));
      CONTINUE;
    END IF;
    cid:=public.create_client_with_care_team(btrim(item->>'first_name'),nullif(btrim(item->>'last_name'),''),nullif(btrim(item->>'preferred_name'),''),ARRAY[p_location_id],'{}'::uuid[],NULL);
    UPDATE public.clients SET import_external_id=external_id WHERE id=cid AND organization_id=org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Client import could not be completed' USING ERRCODE='42501'; END IF;
    output:=output||jsonb_build_array(jsonb_build_object('external_id',external_id,'status','created'));
  END LOOP;
  RETURN output;
END;
$fn$;
REVOKE ALL ON FUNCTION public.import_clients(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_clients(jsonb,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
