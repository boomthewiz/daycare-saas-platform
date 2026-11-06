BEGIN;
-- Presentation defaults only. No backfill or inference from vocabulary or records.
CREATE TABLE rejoyce_security.service_model_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 model text NOT NULL CHECK (model IN ('daycare','aba','mixed')),
 version integer NOT NULL CHECK (version > 0),
 updated_by uuid NOT NULL REFERENCES public.users(id), updated_at timestamptz NOT NULL
);
CREATE TABLE rejoyce_security.service_model_history (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), version integer NOT NULL,
 previous_model text NOT NULL, model text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,version)
);
ALTER TABLE rejoyce_security.service_model_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.service_model_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.service_model_settings,rejoyce_security.service_model_history FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.account_service_model() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; s rejoyce_security.service_model_settings%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL THEN RAISE EXCEPTION 'Active organization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM rejoyce_security.service_model_settings WHERE organization_id=org;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'model',coalesce(s.model,'unconfirmed'),'version',coalesce(s.version,0),
 'updatedBy',s.updated_by,'updatedAt',s.updated_at,
 'canManage',public.can_manage_users() AND public.current_user_role() IN ('owner','admin'),
 'canWrite',rejoyce_security.organization_can_write(org));
END $$;
CREATE FUNCTION public.account_service_model() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT rejoyce_security.account_service_model() $$;

CREATE FUNCTION rejoyce_security.set_account_service_model(p_organization uuid,p_model text,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; s rejoyce_security.service_model_settings%rowtype; stamp timestamptz:=clock_timestamp();
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 org:=public.current_organization_id();
 -- Same privileged configuration authority as attendance activation. A role name alone is insufficient.
 IF auth.uid() IS NULL OR org IS NULL OR p_organization IS DISTINCT FROM org OR
 NOT public.can_manage_users() OR public.current_user_role() NOT IN ('owner','admin') OR NOT rejoyce_security.organization_can_write(org) THEN
 RAISE EXCEPTION 'Account configuration and editing access required' USING ERRCODE='42501'; END IF;
 IF p_model IS NULL OR p_model NOT IN ('daycare','aba','mixed') OR p_version IS NULL OR p_version<0 THEN
 RAISE EXCEPTION 'Choose Daycare, ABA or Mixed and review the current version' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO s FROM rejoyce_security.service_model_settings WHERE organization_id=org;
 IF coalesce(s.version,0)<>p_version THEN RAISE EXCEPTION 'Service model changed. Reload and review before saving.' USING ERRCODE='40001'; END IF;
 INSERT INTO rejoyce_security.service_model_settings(organization_id,model,version,updated_by,updated_at)
 VALUES(org,p_model,p_version+1,auth.uid(),stamp)
 ON CONFLICT(organization_id) DO UPDATE SET model=excluded.model,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 INSERT INTO rejoyce_security.service_model_history VALUES(org,p_version+1,coalesce(s.model,'unconfirmed'),p_model,auth.uid(),stamp);
 RETURN rejoyce_security.account_service_model();
END $$;
CREATE FUNCTION public.set_account_service_model(p_organization uuid,p_model text,p_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.set_account_service_model(p_organization,p_model,p_version) $$;
REVOKE ALL ON FUNCTION public.account_service_model(),rejoyce_security.account_service_model(),public.set_account_service_model(uuid,text,integer),rejoyce_security.set_account_service_model(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_service_model(),rejoyce_security.account_service_model(),public.set_account_service_model(uuid,text,integer),rejoyce_security.set_account_service_model(uuid,text,integer) TO authenticated;
COMMIT;
