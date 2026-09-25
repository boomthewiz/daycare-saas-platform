-- New self-service organizations opt into these terms. Existing organizations
-- are not silently placed on a trial or billed by this migration.
CREATE TABLE rejoyce_security.organization_subscriptions (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 owner_id uuid NOT NULL UNIQUE REFERENCES public.users(id),
 plan_version text NOT NULL DEFAULT 'launch-2026-09',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 trial_ends_at timestamptz NOT NULL,
 paid_through timestamptz,
 stripe_customer_id text UNIQUE,
 stripe_subscription_id text UNIQUE,
 provider_seats integer CHECK(provider_seats >= 1),
 creation_payload jsonb NOT NULL,
 CHECK(trial_ends_at > created_at)
);
ALTER TABLE rejoyce_security.organization_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.organization_subscriptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON rejoyce_security.organization_subscriptions TO service_role;
CREATE POLICY subscription_server ON rejoyce_security.organization_subscriptions TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION rejoyce_security.organization_can_write(p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id)
 OR EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id
   AND greatest(b.trial_ends_at,b.paid_through)>statement_timestamp());
$$;
REVOKE ALL ON FUNCTION rejoyce_security.organization_can_write(uuid) FROM PUBLIC,anon,authenticated;

-- A finishing exception belongs to a session that was underway at trial expiry,
-- not one that was merely scheduled then, or finished before expiry.
CREATE FUNCTION rejoyce_security.session_trial_exception(p_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.sessions s JOIN rejoyce_security.organization_subscriptions b ON b.organization_id=s.organization_id
 WHERE s.id=p_session_id AND s.started_at >= b.created_at AND s.started_at < b.trial_ends_at
 AND (s.completed_at IS NULL OR s.completed_at >= b.trial_ends_at)
 AND s.status IN ('in_progress','paused','completed'));
$$;
REVOKE ALL ON FUNCTION rejoyce_security.session_trial_exception(uuid) FROM PUBLIC,anon,authenticated;

-- This trigger also runs inside definer RPCs, so an open tab or a direct API
-- call cannot bypass the subscription rule. Existing RLS still authorizes reads.
CREATE FUNCTION rejoyce_security.guard_subscription_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; org uuid; sid uuid; before_data jsonb; allowed boolean:=false;
BEGIN
 IF current_setting('role',true) NOT IN ('authenticated','anon','service_role') THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 org:=CASE WHEN TG_TABLE_NAME='organizations' THEN (row_data->>'id')::uuid ELSE (row_data->>'organization_id')::uuid END;
 IF org IS NULL OR rejoyce_security.organization_can_write(org) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN before_data:=to_jsonb(OLD); END IF;
 -- Authentication maintenance remains possible while records are read-only.
 IF TG_TABLE_NAME='users' AND TG_OP='UPDATE'
   AND (row_data - ARRAY['pin_hash','pin_reset_required','email']) = (before_data - ARRAY['pin_hash','pin_reset_required','email']) THEN RETURN NEW; END IF;
 sid:=CASE WHEN TG_TABLE_NAME='sessions' THEN (row_data->>'id')::uuid ELSE (row_data->>'session_id')::uuid END;
 IF sid IS NOT NULL AND rejoyce_security.session_trial_exception(sid) THEN
   IF TG_TABLE_NAME='sessions' AND TG_OP='UPDATE' THEN
     allowed:=OLD.status IN ('in_progress','paused') AND NEW.status IN ('in_progress','paused','completed')
       AND (row_data - ARRAY['status','paused_at','completed_at','total_paused_seconds','updated_at']) =
           (before_data - ARRAY['status','paused_at','completed_at','total_paused_seconds','updated_at']);
   ELSIF TG_TABLE_NAME IN ('target_responses','behavior_events') THEN
     allowed:=EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=sid AND s.status IN ('in_progress','paused'));
   ELSIF TG_TABLE_NAME='session_targets' AND TG_OP='UPDATE' THEN
     allowed:=(row_data - ARRAY['status','completed_at','updated_at'])=(before_data - ARRAY['status','completed_at','updated_at'])
       AND EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=sid AND s.status IN ('in_progress','paused'));
   ELSIF TG_TABLE_NAME='session_notes' THEN
     allowed:=(TG_OP='INSERT' AND row_data->>'status'='draft') OR
       (TG_OP='UPDATE' AND before_data->>'status' IN ('draft','returned') AND row_data->>'status' IN ('draft','returned','submitted'));
   ELSIF TG_TABLE_NAME='session_note_history' AND TG_OP='INSERT' THEN
     allowed:=row_data->>'action' IN ('save','submit');
   END IF;
 END IF;
 IF NOT coalesce(allowed,false) THEN
   RAISE EXCEPTION 'Your trial has ended. Records are read-only until your organization subscribes. Sessions underway when the trial ended may be finished and their notes submitted.' USING ERRCODE='P4020';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION rejoyce_security.guard_subscription_write() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables b
 ON b.table_schema=c.table_schema AND b.table_name=c.table_name
 WHERE c.table_schema='public' AND b.table_type='BASE TABLE' AND (c.column_name='organization_id' OR c.table_name='organizations') LOOP
 EXECUTE format('CREATE TRIGGER zz_subscription_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_subscription_write()',t.table_name);
 END LOOP;
END $$;

CREATE FUNCTION rejoyce_security.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; b rejoyce_security.organization_subscriptions%rowtype; can_write boolean; exception boolean:=false;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT organization_id INTO org FROM public.users WHERE id=auth.uid() AND status='active';
 IF org IS NULL THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM rejoyce_security.organization_subscriptions WHERE organization_id=org;
 IF NOT FOUND THEN RETURN jsonb_build_object('managed',false,'canWrite',true,'canFinishSession',true,'serverNow',statement_timestamp()); END IF;
 can_write:=rejoyce_security.organization_can_write(org);
 IF p_session_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.sessions WHERE id=p_session_id AND organization_id=org AND provider_id=auth.uid()) THEN
   exception:=rejoyce_security.session_trial_exception(p_session_id);
 END IF;
 RETURN jsonb_build_object('managed',true,'canWrite',can_write,'canFinishSession',can_write OR exception,
   'trialEndsAt',b.trial_ends_at,'paidThrough',b.paid_through,'serverNow',statement_timestamp(),'planVersion',b.plan_version,
   'canManageBilling',public.can_manage_billing());
END;
$$;
REVOKE ALL ON FUNCTION rejoyce_security.subscription_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.subscription_access(uuid) TO authenticated;
CREATE FUNCTION public.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.subscription_access(p_session_id); $$;
REVOKE ALL ON FUNCTION public.subscription_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.subscription_access(uuid) TO authenticated;

CREATE FUNCTION public.organization_write_access(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT organization_id IS NOT NULL AND rejoyce_security.organization_can_write(organization_id)
 FROM public.users WHERE id=p_user_id AND status='active'),false);
$$;
REVOKE ALL ON FUNCTION public.organization_write_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_write_access(uuid) TO service_role;

-- Server-only bootstrap: identity comes from a verified bearer token, and SQL
-- independently requires the email-authenticated device and confirmed email.
CREATE FUNCTION public.create_self_service_organization(p_user_id uuid,p_session_id uuid,p_name text,p_full_name text,p_branch_name text,p_organization_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%rowtype; b rejoyce_security.organization_subscriptions%rowtype; payload jsonb; org uuid; stamp timestamptz:=clock_timestamp();
BEGIN
 IF length(trim(p_name)) NOT BETWEEN 1 AND 160 OR length(trim(p_full_name)) NOT BETWEEN 1 AND 160
 OR length(trim(p_branch_name)) NOT BETWEEN 1 AND 160 OR length(trim(p_organization_type)) NOT BETWEEN 1 AND 80
 OR p_name IS NULL OR p_full_name IS NULL OR p_branch_name IS NULL OR p_organization_type IS NULL THEN RAISE EXCEPTION 'Complete the required organization fields'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users a JOIN auth.sessions s ON s.user_id=a.id
 JOIN public.device_sessions d ON d.session_id=s.id AND d.user_id=a.id
 WHERE a.id=p_user_id AND s.id=p_session_id AND a.email_confirmed_at IS NOT NULL AND NOT coalesce(a.is_anonymous,false)
 AND NOT d.revoked AND d.full_auth_at>stamp-interval '1 hour' AND d.unlocked_until>stamp
 AND (s.not_after IS NULL OR s.not_after>stamp)) THEN RAISE EXCEPTION 'Verify your email again to create your organization' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR u.status<>'active' THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('name',trim(p_name),'full_name',trim(p_full_name),'branch_name',trim(p_branch_name),'organization_type',trim(p_organization_type));
 SELECT * INTO b FROM rejoyce_security.organization_subscriptions WHERE owner_id=p_user_id;
 IF FOUND THEN
   IF b.creation_payload<>payload THEN RAISE EXCEPTION 'Your organization is already created. Open your workspace.' USING ERRCODE='23505'; END IF;
   RETURN b.organization_id;
 END IF;
 IF u.organization_id IS NOT NULL THEN RAISE EXCEPTION 'This account already belongs to an organization. Sign in to that workspace.' USING ERRCODE='23505'; END IF;
 INSERT INTO public.organizations(name,organization_type,contact_email) VALUES(trim(p_name),trim(p_organization_type),u.email) RETURNING id INTO org;
 INSERT INTO rejoyce_security.organization_subscriptions(organization_id,owner_id,created_at,trial_ends_at,creation_payload)
 VALUES(org,u.id,stamp,stamp+interval '30 days',payload);
 UPDATE public.users SET organization_id=org,role='owner',full_name=trim(p_full_name) WHERE id=u.id;
 INSERT INTO public.organization_locations(organization_id,name) VALUES(org,trim(p_branch_name));
 RETURN org;
END;
$$;
REVOKE ALL ON FUNCTION public.create_self_service_organization(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_self_service_organization(uuid,uuid,text,text,text,text) TO service_role;
