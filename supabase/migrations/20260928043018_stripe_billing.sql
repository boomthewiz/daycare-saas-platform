-- Additive only. Do NOT replay the onboarding or lifecycle migrations: their
-- deployed versions differ from the repository filenames (see billing docs).
CREATE TABLE rejoyce_security.billing_state (
 organization_id uuid PRIMARY KEY REFERENCES rejoyce_security.organization_subscriptions(organization_id),
 customer_id text UNIQUE,
 subscription_id text UNIQUE,
 checkout_id text,
 status text NOT NULL DEFAULT 'not_subscribed',
 cancel_at timestamptz,
 seats integer NOT NULL DEFAULT 1 CHECK (seats >= 1),
 desired_revision bigint NOT NULL DEFAULT 0,
 synced_revision bigint NOT NULL DEFAULT -1,
 schedule_id text,
 scheduled_seats integer,
 operation jsonb,
 lease uuid,
 lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rejoyce_security.billing_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.billing_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON rejoyce_security.billing_state TO service_role;
CREATE POLICY billing_server ON rejoyce_security.billing_state TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION rejoyce_security.provider_count(p_org uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*)::integer FROM public.users WHERE organization_id=p_org AND status='active'
 AND role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff');
$$;
REVOKE ALL ON FUNCTION rejoyce_security.provider_count(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.billing_owner_context(p_user uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; sub rejoyce_security.organization_subscriptions%rowtype; b rejoyce_security.billing_state%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN public.device_sessions d ON d.session_id=s.id AND d.user_id=s.user_id
 WHERE s.id=p_session AND s.user_id=p_user AND NOT d.revoked AND d.unlocked_until>clock_timestamp()
 AND (s.not_after IS NULL OR s.not_after>clock_timestamp())) THEN
 RAISE EXCEPTION 'Unlock your session' USING ERRCODE='42501'; END IF;
 SELECT organization_id INTO org FROM public.users WHERE id=p_user AND role='owner' AND status='active';
 IF org IS NULL THEN RAISE EXCEPTION 'Only the organization owner can manage subscriptions' USING ERRCODE='42501'; END IF;
 SELECT * INTO sub FROM rejoyce_security.organization_subscriptions WHERE organization_id=org;
 IF NOT FOUND THEN RETURN jsonb_build_object('managed',false); END IF;
 INSERT INTO rejoyce_security.billing_state(organization_id) VALUES(org) ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM rejoyce_security.billing_state WHERE organization_id=org;
 RETURN to_jsonb(b) || jsonb_build_object('managed',true,'provider_count',rejoyce_security.provider_count(org),
 'trial_ends_at',sub.trial_ends_at,'paid_through',sub.paid_through);
END;
$$;
REVOKE ALL ON FUNCTION public.billing_owner_context(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_owner_context(uuid,uuid) TO service_role;

-- Lease serializes Checkout, customer management, workers and webhooks. Fencing
-- prevents an expired worker from committing over a newer one.
CREATE FUNCTION public.billing_lock(p_org uuid DEFAULT NULL,p_customer text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b rejoyce_security.billing_state%rowtype; sub rejoyce_security.organization_subscriptions%rowtype;
BEGIN
 SELECT * INTO b FROM rejoyce_security.billing_state
 WHERE (p_org IS NOT NULL AND organization_id=p_org) OR (p_org IS NULL AND customer_id=p_customer) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF b.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Billing is busy; retry' USING ERRCODE='55P03'; END IF;
 UPDATE rejoyce_security.billing_state SET lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes'
 WHERE organization_id=b.organization_id RETURNING * INTO b;
 SELECT * INTO sub FROM rejoyce_security.organization_subscriptions WHERE organization_id=b.organization_id;
 RETURN to_jsonb(b)||jsonb_build_object('provider_count',rejoyce_security.provider_count(b.organization_id),
 'trial_ends_at',sub.trial_ends_at,'paid_through',sub.paid_through);
END;
$$;
REVOKE ALL ON FUNCTION public.billing_lock(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_lock(uuid,text) TO service_role;

CREATE FUNCTION public.billing_save(p_org uuid,p_lease uuid,p_patch jsonb,p_release boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b rejoyce_security.billing_state%rowtype;
BEGIN
 SELECT * INTO b FROM rejoyce_security.billing_state WHERE organization_id=p_org FOR UPDATE;
 IF b.lease IS DISTINCT FROM p_lease OR b.lease_until<=clock_timestamp() THEN
 RAISE EXCEPTION 'Billing lease expired' USING ERRCODE='55P03'; END IF;
 UPDATE rejoyce_security.billing_state SET
 customer_id=CASE WHEN p_patch ? 'customer_id' THEN p_patch->>'customer_id' ELSE customer_id END,
 subscription_id=CASE WHEN p_patch ? 'subscription_id' THEN p_patch->>'subscription_id' ELSE subscription_id END,
 checkout_id=CASE WHEN p_patch ? 'checkout_id' THEN p_patch->>'checkout_id' ELSE checkout_id END,
 schedule_id=CASE WHEN p_patch ? 'schedule_id' THEN p_patch->>'schedule_id' ELSE schedule_id END,
 scheduled_seats=CASE WHEN p_patch ? 'scheduled_seats' THEN (p_patch->>'scheduled_seats')::integer ELSE scheduled_seats END,
 status=coalesce(p_patch->>'status',status),
 seats=coalesce((p_patch->>'seats')::integer,seats),
 cancel_at=CASE WHEN p_patch ? 'cancel_at' THEN (p_patch->>'cancel_at')::timestamptz ELSE cancel_at END,
 synced_revision=coalesce((p_patch->>'synced_revision')::bigint,synced_revision),
 operation=CASE WHEN p_patch ? 'operation' THEN nullif(p_patch->'operation','null'::jsonb) ELSE operation END,
 updated_at=clock_timestamp(),lease=CASE WHEN p_release THEN NULL ELSE lease END,
 lease_until=CASE WHEN p_release THEN NULL ELSE clock_timestamp()+interval '5 minutes' END
 WHERE organization_id=p_org;
 UPDATE rejoyce_security.organization_subscriptions SET
 stripe_customer_id=coalesce(p_patch->>'customer_id',stripe_customer_id),
 stripe_subscription_id=coalesce(p_patch->>'subscription_id',stripe_subscription_id),
 provider_seats=coalesce((p_patch->>'seats')::integer,provider_seats),
 paid_through=greatest(paid_through,(p_patch->>'paid_through')::timestamptz)
 WHERE organization_id=p_org;
END;
$$;
REVOKE ALL ON FUNCTION public.billing_save(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_save(uuid,uuid,jsonb,boolean) TO service_role;

CREATE FUNCTION rejoyce_security.queue_billing_seats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.role,NEW.status) IS NOT DISTINCT FROM (OLD.organization_id,OLD.role,OLD.status) THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN UPDATE rejoyce_security.billing_state SET desired_revision=desired_revision+1 WHERE organization_id=OLD.organization_id; END IF;
 IF TG_OP<>'DELETE' THEN UPDATE rejoyce_security.billing_state SET desired_revision=desired_revision+1 WHERE organization_id=NEW.organization_id; RETURN NEW; END IF;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION rejoyce_security.queue_billing_seats() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER queue_billing_seats AFTER INSERT OR UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.queue_billing_seats();

CREATE FUNCTION public.billing_work() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT organization_id FROM rejoyce_security.billing_state
 WHERE customer_id IS NOT NULL AND (lease_until IS NULL OR lease_until<=clock_timestamp())
 ORDER BY updated_at LIMIT 25;
$$;
REVOKE ALL ON FUNCTION public.billing_work() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_work() TO service_role;
