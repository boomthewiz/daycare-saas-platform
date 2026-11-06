BEGIN;
-- No operational defaults: an approved policy is an explicit later activation.
CREATE TABLE rejoyce_security.billing_grace_policies (
 version integer PRIMARY KEY CHECK(version>0), active boolean NOT NULL DEFAULT false,
 max_duration_seconds integer NOT NULL CHECK(max_duration_seconds>0),
 max_renewals integer NOT NULL CHECK(max_renewals>=0),
 stepup_seconds integer NOT NULL CHECK(stepup_seconds>0),
 requires_second_approval boolean NOT NULL,
 approved_by uuid NOT NULL REFERENCES auth.users(id), approval_ticket text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_active_grace_policy ON rejoyce_security.billing_grace_policies((true)) WHERE active;
CREATE TABLE rejoyce_security.billing_grace_state (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id), version integer NOT NULL CHECK(version>0)
);
CREATE TABLE rejoyce_security.billing_graces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 policy_version integer NOT NULL REFERENCES rejoyce_security.billing_grace_policies(version),
 scope text NOT NULL CHECK(scope='organization_write'),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>starts_at),
 actor_id uuid NOT NULL REFERENCES auth.users(id), ticket text NOT NULL,
 reason_code text NOT NULL CHECK(reason_code IN ('payment_recovery','pilot_support')),
 issued_version integer NOT NULL, revoked_at timestamptz, revoked_by uuid REFERENCES auth.users(id),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL)), UNIQUE(organization_id,issued_version)
);
CREATE INDEX live_grace_by_org ON rejoyce_security.billing_graces(organization_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE rejoyce_security.billing_grace_operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES auth.users(id), request jsonb NOT NULL, result jsonb NOT NULL
);
CREATE TABLE rejoyce_security.billing_grace_audit (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), version integer NOT NULL,
 grace_id uuid NOT NULL REFERENCES rejoyce_security.billing_graces(id),
 action text NOT NULL CHECK(action IN ('grant','revoke')), actor_id uuid NOT NULL REFERENCES auth.users(id),
 ticket text NOT NULL, policy_version integer NOT NULL, before_expiry timestamptz, after_expiry timestamptz,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(organization_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_grace_policies','billing_grace_state','billing_graces','billing_grace_operations','billing_grace_audit'] LOOP
  EXECUTE format('ALTER TABLE rejoyce_security.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON rejoyce_security.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_billing_grace_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON rejoyce_security.billing_grace_audit
FOR EACH STATEMENT EXECUTE FUNCTION rejoyce_security.reject_support_audit_change();

CREATE FUNCTION rejoyce_security.guard_grace_policy() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR (to_jsonb(OLD)-'active') IS DISTINCT FROM (to_jsonb(NEW)-'active') THEN
  RAISE EXCEPTION 'Approved grace policy versions are immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_grace_policy BEFORE UPDATE OR DELETE ON rejoyce_security.billing_grace_policies
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_grace_policy();
CREATE TRIGGER no_truncate_grace_policy BEFORE TRUNCATE ON rejoyce_security.billing_grace_policies
FOR EACH STATEMENT EXECUTE FUNCTION rejoyce_security.reject_support_audit_change();

CREATE FUNCTION rejoyce_security.require_billing_support(p_workforce_version integer,p_policy_version integer)
RETURNS rejoyce_security.billing_grace_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE member rejoyce_security.support_workforce%rowtype; policy rejoyce_security.billing_grace_policies%rowtype;
 stamp timestamptz:=clock_timestamp(); sid uuid; amr jsonb; fresh boolean:=false;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT * INTO member FROM rejoyce_security.support_workforce WHERE user_id=auth.uid() FOR SHARE;
 IF NOT FOUND OR NOT member.active OR member.role NOT IN ('billing','administrator') OR member.version IS DISTINCT FROM p_workforce_version THEN
  RAISE EXCEPTION 'Billing support authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO policy FROM rejoyce_security.billing_grace_policies WHERE version=p_policy_version AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Approved grace policy unavailable' USING ERRCODE='42501'; END IF;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'Fresh support MFA required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.sessions s JOIN auth.users a ON a.id=s.user_id
 JOIN public.users u ON u.id=a.id JOIN public.device_sessions d ON d.session_id=s.id AND d.user_id=a.id
 WHERE s.id=sid AND s.user_id=auth.uid() AND s.aal='aal2' AND u.status='active'
 AND (s.not_after IS NULL OR s.not_after>stamp) AND (a.banned_until IS NULL OR a.banned_until<=stamp)
 AND NOT d.revoked AND d.unlocked_until>stamp FOR SHARE OF s,a,u,d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Live unlocked support session required' USING ERRCODE='42501'; END IF;
 -- A token refresh or email OTP is not a fresh second factor. Only TOTP is supported in this slice.
 IF jsonb_typeof(auth.jwt()->'amr')='array' THEN
  FOR amr IN SELECT value FROM jsonb_array_elements(auth.jwt()->'amr') LOOP
   IF amr->>'method'='totp' AND jsonb_typeof(amr->'timestamp')='number' THEN
    IF (amr->>'timestamp')::numeric BETWEEN extract(epoch FROM stamp)-policy.stepup_seconds AND extract(epoch FROM stamp) THEN fresh:=true; END IF;
   END IF;
  END LOOP;
 END IF;
 IF NOT fresh THEN RAISE EXCEPTION 'Fresh support MFA required' USING ERRCODE='42501'; END IF;
 RETURN policy;
END $$;

CREATE FUNCTION rejoyce_security.active_billing_grace(p_org uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT max(g.expires_at) FROM rejoyce_security.billing_graces g
 JOIN rejoyce_security.billing_grace_policies p ON p.version=g.policy_version AND p.active
 WHERE g.organization_id=p_org AND g.scope='organization_write' AND g.revoked_at IS NULL
 AND g.starts_at<=statement_timestamp() AND g.expires_at>statement_timestamp()
 AND EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_org)
$$;

CREATE FUNCTION rejoyce_security.support_billing_grace(
 p_action text,p_org uuid,p_grace uuid,p_expected_version integer,p_policy_version integer,
 p_expires timestamptz,p_ticket text,p_reason text,p_operation uuid,p_workforce_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy rejoyce_security.billing_grace_policies%rowtype; current_version integer;
 grace rejoyce_security.billing_graces%rowtype; receipt rejoyce_security.billing_grace_operations%rowtype;
 payload jsonb; result jsonb; stamp timestamptz; previous_expiry timestamptz;
BEGIN
 policy:=rejoyce_security.require_billing_support(p_workforce_version,p_policy_version);
 IF p_action IS NULL OR p_action NOT IN ('grant','revoke') OR p_org IS NULL OR p_operation IS NULL
 OR p_expected_version IS NULL OR p_expected_version<0 OR p_ticket IS NULL
 OR p_ticket !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$' OR p_reason IS NULL OR p_reason NOT IN ('payment_recovery','pilot_support') THEN
  RAISE EXCEPTION 'Review organization, version, ticket, reason and operation' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions WHERE organization_id=p_org) THEN
  RAISE EXCEPTION 'Managed organization required' USING ERRCODE='42501'; END IF;
 stamp:=clock_timestamp();
 payload:=jsonb_build_object('action',p_action,'organization',p_org,'grace',p_grace,'version',p_expected_version,
  'policy',p_policy_version,'expires',p_expires,'ticket',p_ticket,'reason',p_reason);
 SELECT * INTO receipt FROM rejoyce_security.billing_grace_operations WHERE operation_id=p_operation;
 IF FOUND THEN
  IF receipt.actor_id IS DISTINCT FROM auth.uid() OR receipt.request IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Operation belongs to different reviewed details' USING ERRCODE='22023'; END IF;
  RETURN receipt.result;
 END IF;
 SELECT version INTO current_version FROM rejoyce_security.billing_grace_state WHERE organization_id=p_org;
 current_version:=coalesce(current_version,0);
 IF current_version<>p_expected_version THEN RAISE EXCEPTION 'Billing grace changed. Review again.' USING ERRCODE='40001'; END IF;
 IF p_action='grant' THEN
  IF policy.requires_second_approval THEN RAISE EXCEPTION 'Independent approval workflow required' USING ERRCODE='42501'; END IF;
  IF p_grace IS NOT NULL OR p_expires IS NULL OR NOT isfinite(p_expires) OR p_expires<=stamp
    OR p_expires>stamp+make_interval(secs=>policy.max_duration_seconds) THEN
   RAISE EXCEPTION 'Expiry exceeds the approved grace policy' USING ERRCODE='22023'; END IF;
  IF rejoyce_security.active_billing_grace(p_org) IS NOT NULL THEN RAISE EXCEPTION 'Revoke the current grace before issuing another' USING ERRCODE='40001'; END IF;
  IF (SELECT count(*) FROM rejoyce_security.billing_graces WHERE organization_id=p_org)>policy.max_renewals THEN
   RAISE EXCEPTION 'Grace renewal limit reached' USING ERRCODE='42501'; END IF;
  INSERT INTO rejoyce_security.billing_graces(organization_id,policy_version,scope,starts_at,expires_at,actor_id,ticket,reason_code,issued_version)
  VALUES(p_org,policy.version,'organization_write',stamp,p_expires,auth.uid(),p_ticket,p_reason,current_version+1) RETURNING * INTO grace;
 ELSE
  IF p_grace IS NULL OR p_expires IS NOT NULL THEN RAISE EXCEPTION 'Review the grace to revoke' USING ERRCODE='22023'; END IF;
  SELECT * INTO grace FROM rejoyce_security.billing_graces WHERE id=p_grace AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR grace.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Grace unavailable' USING ERRCODE='42501'; END IF;
  previous_expiry:=grace.expires_at;
  UPDATE rejoyce_security.billing_graces SET revoked_at=stamp,revoked_by=auth.uid() WHERE id=grace.id;
 END IF;
 INSERT INTO rejoyce_security.billing_grace_state VALUES(p_org,current_version+1)
 ON CONFLICT(organization_id) DO UPDATE SET version=excluded.version;
 INSERT INTO rejoyce_security.billing_grace_audit(organization_id,version,grace_id,action,actor_id,ticket,policy_version,before_expiry,after_expiry)
 VALUES(p_org,current_version+1,grace.id,p_action,auth.uid(),p_ticket,policy.version,previous_expiry,CASE WHEN p_action='grant' THEN grace.expires_at END);
 result:=jsonb_build_object('organizationId',p_org,'graceId',grace.id,'version',current_version+1,'action',p_action,
  'expiresAt',CASE WHEN p_action='grant' THEN grace.expires_at END,'serverNow',stamp);
 INSERT INTO rejoyce_security.billing_grace_operations VALUES(p_operation,auth.uid(),payload,result);
 RETURN result;
END $$;
CREATE FUNCTION public.support_billing_grace(p_action text,p_org uuid,p_grace uuid,p_expected_version integer,p_policy_version integer,
 p_expires timestamptz,p_ticket text,p_reason text,p_operation uuid,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.support_billing_grace(p_action,p_org,p_grace,p_expected_version,p_policy_version,p_expires,p_ticket,p_reason,p_operation,p_workforce_version) $$;

CREATE OR REPLACE FUNCTION rejoyce_security.organization_can_write(p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id)
 OR EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id
  AND greatest(b.trial_ends_at,b.paid_through)>statement_timestamp())
 OR rejoyce_security.active_billing_grace(p_organization_id) IS NOT NULL
$$;

-- Keep the existing resolver/finish exception; add truthful grace context only.
ALTER FUNCTION rejoyce_security.subscription_access(uuid) RENAME TO subscription_access_before_grace;
CREATE FUNCTION rejoyce_security.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; expiry timestamptz;
BEGIN
 result:=rejoyce_security.subscription_access_before_grace(p_session_id);
 expiry:=rejoyce_security.active_billing_grace(public.current_organization_id());
 RETURN result||jsonb_build_object('supportGraceExpiresAt',expiry);
END $$;
-- SQL wrappers can retain OID dependencies after a rename; bind explicitly to the new resolver.
CREATE OR REPLACE FUNCTION public.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.subscription_access(p_session_id) $$;

REVOKE ALL ON FUNCTION rejoyce_security.guard_grace_policy(),rejoyce_security.require_billing_support(integer,integer),
 rejoyce_security.active_billing_grace(uuid),rejoyce_security.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer),
 public.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer),rejoyce_security.subscription_access_before_grace(uuid),rejoyce_security.subscription_access(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rejoyce_security.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer),
 public.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer),rejoyce_security.subscription_access(uuid) TO authenticated;
COMMIT;
