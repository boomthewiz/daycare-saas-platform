-- Companies remain the tenant boundary; clients may attend multiple branches.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.organization_locations
  ADD CONSTRAINT organization_locations_tenant_key UNIQUE(id,organization_id);
CREATE TABLE public.client_locations (
  client_id uuid NOT NULL,
  location_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(client_id,location_id),
  CONSTRAINT client_locations_client_fkey FOREIGN KEY(client_id,organization_id)
    REFERENCES public.clients(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT client_locations_location_fkey FOREIGN KEY(location_id,organization_id)
    REFERENCES public.organization_locations(id,organization_id) ON DELETE NO ACTION
);
CREATE INDEX client_locations_client_tenant_idx ON public.client_locations(client_id,organization_id);
CREATE INDEX client_locations_location_tenant_idx ON public.client_locations(location_id,organization_id);
CREATE INDEX client_locations_organization_idx ON public.client_locations(organization_id);
ALTER TABLE public.client_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_locations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.client_locations TO authenticated;
GRANT ALL ON public.client_locations TO service_role;

CREATE POLICY require_unlocked_device ON public.client_locations AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT rejoyce_security.session_is_unlocked()))
  WITH CHECK ((SELECT rejoyce_security.session_is_unlocked()));
CREATE POLICY "Visible client branches" ON public.client_locations FOR SELECT TO authenticated
  USING (organization_id=(SELECT public.current_organization_id())
    AND EXISTS(SELECT 1 FROM public.clients c WHERE c.id=client_id));
CREATE POLICY "Client managers assign branches" ON public.client_locations FOR INSERT TO authenticated
  WITH CHECK (organization_id=(SELECT public.current_organization_id())
    AND (SELECT public.can_manage_clients())
    AND EXISTS(SELECT 1 FROM public.organization_locations l
      WHERE l.id=location_id AND l.organization_id=client_locations.organization_id AND l.active));
CREATE POLICY "Client managers remove branches" ON public.client_locations FOR DELETE TO authenticated
  USING (organization_id=(SELECT public.current_organization_id())
    AND (SELECT public.can_manage_clients()));
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.client_locations
  FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();

-- Invoker functions preserve caller RLS and make multi-table writes atomic.
CREATE FUNCTION public.set_client_locations(p_client_id uuid,p_location_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE org uuid; selected_ids uuid[]; valid_count integer;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_clients() THEN
    RAISE EXCEPTION 'You do not have permission to manage client branches' USING ERRCODE='42501';
  END IF;
  IF p_location_ids IS NULL OR cardinality(p_location_ids)=0 OR array_position(p_location_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Choose at least one branch' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO selected_ids FROM unnest(p_location_ids) id;
  PERFORM 1 FROM public.clients WHERE id=p_client_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found' USING ERRCODE='42501'; END IF;
  -- Existing inactive assignments may be retained; only active branches may be added.
  -- FK enforcement remains authoritative if a branch changes concurrently.
  SELECT count(*) INTO valid_count FROM public.organization_locations l
    WHERE l.id=ANY(selected_ids) AND l.organization_id=org
      AND (l.active OR EXISTS(SELECT 1 FROM public.client_locations cl
        WHERE cl.client_id=p_client_id AND cl.location_id=l.id));
  IF valid_count<>cardinality(selected_ids) THEN
    RAISE EXCEPTION 'Choose active branches from your organization' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.client_locations WHERE client_id=p_client_id AND NOT(location_id=ANY(selected_ids));
  INSERT INTO public.client_locations(client_id,location_id,organization_id)
    SELECT p_client_id,id,org FROM unnest(selected_ids) id
    WHERE NOT EXISTS(SELECT 1 FROM public.client_locations cl WHERE cl.client_id=p_client_id AND cl.location_id=id);
END;
$function$;

CREATE FUNCTION public.create_client_with_locations(
  p_first_name text,p_last_name text,p_preferred_name text,p_assigned_provider_id uuid,p_location_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE org uuid; client_id uuid;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL OR NOT public.can_manage_clients() THEN
    RAISE EXCEPTION 'You do not have permission to create clients' USING ERRCODE='42501';
  END IF;
  IF nullif(btrim(p_first_name),'') IS NULL THEN
    RAISE EXCEPTION 'A first name is required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.clients(organization_id,first_name,last_name,preferred_name,assigned_provider_id,status)
    VALUES(org,btrim(p_first_name),nullif(btrim(p_last_name),''),nullif(btrim(p_preferred_name),''),p_assigned_provider_id,'active')
    RETURNING id INTO client_id;
  PERFORM public.set_client_locations(client_id,p_location_ids);
  RETURN client_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_client_locations(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_client_with_locations(text,text,text,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_locations(uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_with_locations(text,text,text,uuid,uuid[]) TO authenticated;
-- Self-cleaning fixtures; run with a database administrator connection.
DO $branch_tests$
DECLARE
  oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); delegate_id uuid:=gen_random_uuid();
  os uuid:=gen_random_uuid(); ss uuid:=gen_random_uuid(); ds uuid:=gen_random_uuid();
  a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid(); b1 uuid:=gen_random_uuid();
  ca uuid; cb uuid; other_client uuid; n integer; before_count integer;
BEGIN
  BEGIN
    INSERT INTO public.organizations(id,name) VALUES(oa,'Branch test A'),(ob,'Branch test B');
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      (owner_id,owner_id::text||'@example.invalid','{}'),
      (staff_id,staff_id::text||'@example.invalid','{}'),
      (delegate_id,delegate_id::text||'@example.invalid','{}');
    UPDATE public.users SET organization_id=oa,status='active',pin_hash='synthetic',pin_reset_required=false
      WHERE id IN(owner_id,staff_id,delegate_id);
    UPDATE public.users SET role='owner' WHERE id=owner_id;
    UPDATE public.users SET role='teacher' WHERE id IN(staff_id,delegate_id);
    INSERT INTO public.user_permissions(user_id,organization_id,can_manage_clients,can_manage_sessions)
      VALUES(delegate_id,oa,true,false);
    INSERT INTO auth.sessions(id,user_id,created_at)
      VALUES(os,owner_id,now()),(ss,staff_id,now()),(ds,delegate_id,now());
    INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
      VALUES(os,owner_id,now(),now(),now()+interval '5 minutes'),
            (ss,staff_id,now(),now(),now()+interval '5 minutes'),
            (ds,delegate_id,now(),now(),now()+interval '5 minutes');
    INSERT INTO public.organization_locations(id,organization_id,name,active)
      VALUES(a1,oa,'North',true),(a2,oa,'South',true),(inactive_id,oa,'Archived',false),(b1,ob,'Foreign',true);
    INSERT INTO public.clients(organization_id,first_name) VALUES(ob,'Foreign client') RETURNING id INTO cb;
    INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(cb,b1,ob);
    PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',os,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    ca:=public.create_client_with_locations('Synthetic','Client',NULL,staff_id,ARRAY[a1,a2,a1]);
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>2 THEN RAISE EXCEPTION 'Multiple branch assignment or deduplication failed'; END IF;
    SELECT count(*) INTO before_count FROM public.clients;
    BEGIN
      PERFORM public.create_client_with_locations('Must roll back',NULL,NULL,NULL,ARRAY[a1,b1]);
      RAISE EXCEPTION 'Foreign branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    SELECT count(*) INTO n FROM public.clients;
    IF n<>before_count THEN RAISE EXCEPTION 'Failed assignment left a partial client'; END IF;
    BEGIN
      PERFORM public.create_client_with_locations('No branches',NULL,NULL,NULL,ARRAY[]::uuid[]);
      RAISE EXCEPTION 'Empty selection accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[a1,NULL]::uuid[]);
      RAISE EXCEPTION 'Null branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[inactive_id]);
      RAISE EXCEPTION 'New inactive branch accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.set_client_locations(cb,ARRAY[a1]);
      RAISE EXCEPTION 'Foreign client edit accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=cb;
    IF n<>0 THEN RAISE EXCEPTION 'Foreign branch memberships leaked'; END IF;
    UPDATE public.organization_locations SET active=false WHERE id=a2;
    PERFORM public.set_client_locations(ca,ARRAY[a1,a2]);
    PERFORM public.set_client_locations(ca,ARRAY[a1]);
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>1 THEN RAISE EXCEPTION 'Replace branch set failed'; END IF;
    BEGIN
      DELETE FROM public.organization_locations WHERE id=a1;
      RAISE EXCEPTION 'Deleting assigned branch created orphan';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    other_client:=public.create_client_with_locations('Unassigned to staff',NULL,NULL,NULL,ARRAY[a1]);
    RESET ROLE;

    -- Even service-side mistakes cannot create cross-company membership rows.
    BEGIN
      INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(ca,b1,oa);
      RAISE EXCEPTION 'Cross-company relationship bypassed FK';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.client_locations(client_id,location_id,organization_id) VALUES(cb,a1,oa);
      RAISE EXCEPTION 'Foreign client bypassed FK';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.client_locations SET organization_id=ob WHERE client_id=ca;
      RAISE EXCEPTION 'Existing membership moved company';
    EXCEPTION WHEN check_violation THEN NULL; END;

    PERFORM set_config('request.jwt.claim.sub',staff_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'session_id',ss,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>1 THEN RAISE EXCEPTION 'Assigned staff cannot read client branches'; END IF;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=other_client OR client_id=cb;
    IF n<>0 THEN RAISE EXCEPTION 'Unassigned or foreign client membership leaked'; END IF;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[inactive_id]);
      RAISE EXCEPTION 'Staff changed branches';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.create_client_with_locations('Unauthorized',NULL,NULL,NULL,ARRAY[a1]);
      RAISE EXCEPTION 'Staff created client';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;

    -- A client-management grant works without requiring session-management rights.
    PERFORM set_config('request.jwt.claim.sub',delegate_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',delegate_id,'session_id',ds,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM public.set_client_locations(ca,ARRAY[a1]);
    PERFORM public.create_client_with_locations('Delegated client',NULL,NULL,NULL,ARRAY[a1]);
    RESET ROLE;

    UPDATE public.device_sessions SET unlocked_until=now()-interval '1 second' WHERE session_id=ds;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.client_locations WHERE client_id=ca;
    IF n<>0 THEN RAISE EXCEPTION 'Locked session read memberships'; END IF;
    BEGIN
      PERFORM public.set_client_locations(ca,ARRAY[a1]);
      RAISE EXCEPTION 'Locked session wrote memberships';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    IF has_function_privilege('anon','public.set_client_locations(uuid,uuid[])','EXECUTE')
      OR has_function_privilege('anon','public.create_client_with_locations(text,text,text,uuid,uuid[])','EXECUTE')
      OR has_table_privilege('authenticated','public.client_locations','TRUNCATE')
    THEN RAISE EXCEPTION 'Unsafe branch API privileges'; END IF;
    DELETE FROM public.clients WHERE id=ca;
    IF EXISTS(SELECT 1 FROM public.client_locations WHERE client_id=ca) THEN RAISE EXCEPTION 'Client delete left memberships'; END IF;
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Discard successful branch fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$branch_tests$;

NOTIFY pgrst,'reload schema';
