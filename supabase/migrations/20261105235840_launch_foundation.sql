BEGIN;
CREATE TABLE rejoyce_security.clinical_modules (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL CHECK(version>0)
);
CREATE TABLE rejoyce_security.clinical_program_grants (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 program_read boolean NOT NULL DEFAULT false, program_edit boolean NOT NULL DEFAULT false,
 version integer NOT NULL CHECK(version>0), PRIMARY KEY(organization_id,user_id),
 CHECK(NOT program_edit OR program_read)
);
CREATE TABLE rejoyce_security.support_workforce (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 role text NOT NULL CHECK(role IN ('agent','billing','administrator')),
 active boolean NOT NULL DEFAULT false, version integer NOT NULL CHECK(version>0)
);
CREATE TABLE rejoyce_security.support_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES auth.users(id),
 workforce_version integer NOT NULL, action text NOT NULL CHECK(action='organization.metadata.read'),
 target_ids uuid[] NOT NULL, ticket text NOT NULL CHECK(ticket ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clinical_modules','clinical_program_grants','support_workforce','support_audit'] LOOP
  EXECUTE format('ALTER TABLE rejoyce_security.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON rejoyce_security.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION rejoyce_security.clinical_program_allowed(p_org uuid,p_client uuid,p_edit boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(rejoyce_security.session_is_unlocked()
 AND p_org=public.current_organization_id()
 AND EXISTS(SELECT 1 FROM rejoyce_security.clinical_modules WHERE organization_id=p_org AND enabled)
 AND EXISTS(SELECT 1 FROM rejoyce_security.clinical_program_grants
   WHERE organization_id=p_org AND user_id=auth.uid() AND program_read AND (NOT p_edit OR program_edit))
 AND public.can_access_client(p_client)
 AND (NOT p_edit OR (public.can_manage_clients() AND rejoyce_security.organization_can_write(p_org))),false)
$$;
CREATE FUNCTION rejoyce_security.clinical_program_access(p_client uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_access_client(p_client) THEN RAISE EXCEPTION 'Client unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('userId',auth.uid(),'organizationId',org,'clientId',p_client,
 'read',rejoyce_security.clinical_program_allowed(org,p_client,false),
 'edit',rejoyce_security.clinical_program_allowed(org,p_client,true));
END $$;
CREATE FUNCTION public.clinical_program_access(p_client uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.clinical_program_access(p_client) $$;

-- Restrictive policies intersect all older permissive policies, including direct writes.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['client_targets','client_behaviors'] LOOP
  EXECUTE format('CREATE POLICY clinical_program_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (rejoyce_security.clinical_program_allowed(organization_id,client_id,false))',t);
  EXECUTE format('CREATE POLICY clinical_program_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (rejoyce_security.clinical_program_allowed(organization_id,client_id,true))',t);
  EXECUTE format('CREATE POLICY clinical_program_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (rejoyce_security.clinical_program_allowed(organization_id,client_id,true)) WITH CHECK (rejoyce_security.clinical_program_allowed(organization_id,client_id,true))',t);
  EXECUTE format('CREATE POLICY clinical_program_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (rejoyce_security.clinical_program_allowed(organization_id,client_id,true))',t);
 END LOOP;
END $$;

-- Definer RPCs can bypass RLS. Guard their writes as well, using the verified caller,
-- not current_user (which becomes the definer). Operator/service contexts with no
-- end-user JWT remain a separate trusted, non-customer boundary.
CREATE FUNCTION rejoyce_security.guard_clinical_program() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; child uuid;
BEGIN
 IF auth.uid() IS NOT NULL OR current_setting('role',true) IN ('authenticated','anon') THEN
  IF TG_OP='DELETE' THEN org:=OLD.organization_id; child:=OLD.client_id;
  ELSE org:=NEW.organization_id; child:=NEW.client_id; END IF;
  IF NOT rejoyce_security.clinical_program_allowed(org,child,true) THEN
   RAISE EXCEPTION 'Clinical program editing unavailable' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.client_id IS DISTINCT FROM NEW.client_id) THEN
   RAISE EXCEPTION 'Clinical definitions cannot move between records' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER clinical_program_guard BEFORE INSERT OR UPDATE OR DELETE ON public.client_targets FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_program();
CREATE TRIGGER clinical_program_guard BEFORE INSERT OR UPDATE OR DELETE ON public.client_behaviors FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_program();

CREATE FUNCTION rejoyce_security.reject_support_audit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Support audit is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER immutable_support_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON rejoyce_security.support_audit FOR EACH STATEMENT EXECUTE FUNCTION rejoyce_security.reject_support_audit_change();

CREATE FUNCTION rejoyce_security.support_organization_lookup(p_query text,p_ticket text,p_workforce_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE member rejoyce_security.support_workforce%rowtype; result jsonb; targets uuid[]; exact_id uuid; sid uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 -- Held through the audited read; revocation updates serialize against this lock.
 SELECT * INTO member FROM rejoyce_security.support_workforce WHERE user_id=auth.uid() FOR SHARE;
 IF NOT FOUND OR NOT member.active OR member.version IS DISTINCT FROM p_workforce_version THEN
  RAISE EXCEPTION 'Support access unavailable' USING ERRCODE='42501';
 END IF;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR NOT EXISTS(
  SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=sid AND s.user_id=auth.uid() AND s.aal='aal2'
   AND (s.not_after IS NULL OR s.not_after>clock_timestamp())
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
 ) THEN RAISE EXCEPTION 'Support MFA verification required' USING ERRCODE='42501'; END IF;
 IF p_ticket IS NULL OR p_ticket !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$'
  OR p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 3 AND 100 THEN
  RAISE EXCEPTION 'Use an organization ID or name prefix and a ticket reference' USING ERRCODE='22023';
 END IF;
 IF btrim(p_query) ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN exact_id:=btrim(p_query)::uuid; END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY v->>'id'),'[]'::jsonb),coalesce(array_agg((v->>'id')::uuid),'{}'::uuid[]) INTO result,targets
 FROM (
  SELECT jsonb_build_object('id',o.id,'name',o.name,'model',coalesce(s.model,'unconfirmed'),
   'modelVersion',coalesce(s.version,0),'abaEnabled',coalesce(m.enabled,false),'moduleVersion',coalesce(m.version,0)) v
  FROM public.organizations o LEFT JOIN rejoyce_security.service_model_settings s ON s.organization_id=o.id
  LEFT JOIN rejoyce_security.clinical_modules m ON m.organization_id=o.id
  WHERE (exact_id IS NOT NULL AND o.id=exact_id) OR
   (exact_id IS NULL AND left(lower(o.name),length(btrim(p_query)))=lower(btrim(p_query)))
  ORDER BY o.id LIMIT 20
 ) found;
 INSERT INTO rejoyce_security.support_audit(actor_id,workforce_version,action,target_ids,ticket)
 VALUES(auth.uid(),member.version,'organization.metadata.read',targets,p_ticket);
 RETURN jsonb_build_object('organizations',result,'workforceVersion',member.version);
END $$;
CREATE FUNCTION public.support_organization_lookup(p_query text,p_ticket text,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.support_organization_lookup(p_query,p_ticket,p_workforce_version) $$;

REVOKE ALL ON FUNCTION rejoyce_security.clinical_program_allowed(uuid,uuid,boolean),rejoyce_security.clinical_program_access(uuid),public.clinical_program_access(uuid),rejoyce_security.guard_clinical_program(),rejoyce_security.reject_support_audit_change(),rejoyce_security.support_organization_lookup(text,text,integer),public.support_organization_lookup(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION rejoyce_security.clinical_program_allowed(uuid,uuid,boolean),rejoyce_security.clinical_program_access(uuid),public.clinical_program_access(uuid),rejoyce_security.support_organization_lookup(text,text,integer),public.support_organization_lookup(text,text,integer) TO authenticated;
COMMIT;
