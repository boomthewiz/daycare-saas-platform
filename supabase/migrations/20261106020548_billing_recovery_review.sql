BEGIN;
CREATE TABLE rejoyce_security.billing_grace_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), workforce_version integer NOT NULL,
 policy_version integer NOT NULL REFERENCES rejoyce_security.billing_grace_policies(version),
 request jsonb NOT NULL, snapshot jsonb NOT NULL,
 valid_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 operation_id uuid UNIQUE, result jsonb,
 CHECK((operation_id IS NULL)=(result IS NULL))
);
CREATE TABLE rejoyce_security.billing_grace_approvals (
 review_id uuid PRIMARY KEY REFERENCES rejoyce_security.billing_grace_reviews(id),
 approver_id uuid NOT NULL REFERENCES auth.users(id), workforce_version integer NOT NULL,
 session_id uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rejoyce_security.billing_grace_review_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES rejoyce_security.billing_grace_reviews(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL CHECK(action IN ('prepared','viewed','approved','confirmed')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rejoyce_security.billing_grace_review_permits (
 transaction_id bigint NOT NULL, review_id uuid NOT NULL REFERENCES rejoyce_security.billing_grace_reviews(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY(transaction_id,review_id)
);
CREATE TABLE rejoyce_security.billing_grace_notices (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), version integer NOT NULL,
 action text NOT NULL CHECK(action IN ('grant','revoke')), expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(organization_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_grace_reviews','billing_grace_approvals','billing_grace_review_audit','billing_grace_review_permits','billing_grace_notices'] LOOP
  EXECUTE format('ALTER TABLE rejoyce_security.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON rejoyce_security.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['billing_grace_approvals','billing_grace_review_audit','billing_grace_notices'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_recovery_record BEFORE UPDATE OR DELETE OR TRUNCATE ON rejoyce_security.%I FOR EACH STATEMENT EXECUTE FUNCTION rejoyce_security.reject_support_audit_change()',t);
 END LOOP;
END $$;

ALTER FUNCTION rejoyce_security.support_organization_lookup(text,text,integer) RENAME TO support_organization_lookup_before_recovery;
CREATE FUNCTION rejoyce_security.support_organization_lookup(p_query text,p_ticket text,p_workforce_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; allowed boolean; BEGIN
 result:=rejoyce_security.support_organization_lookup_before_recovery(p_query,p_ticket,p_workforce_version);
 SELECT role IN ('billing','administrator') INTO allowed FROM rejoyce_security.support_workforce WHERE user_id=auth.uid();
 RETURN result||jsonb_build_object('billingRecovery',coalesce(allowed,false));
END $$;
CREATE OR REPLACE FUNCTION public.support_organization_lookup(p_query text,p_ticket text,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.support_organization_lookup(p_query,p_ticket,p_workforce_version) $$;
REVOKE ALL ON FUNCTION rejoyce_security.support_organization_lookup_before_recovery(text,text,integer),rejoyce_security.support_organization_lookup(text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rejoyce_security.support_organization_lookup(text,text,integer) TO authenticated;

-- Sensitive recovery always enforces PIN readiness and bounded authentication age.
DO $$ DECLARE definition text; marker text:='AND NOT d.revoked AND d.unlocked_until>stamp'; BEGIN
 SELECT pg_get_functiondef('rejoyce_security.require_billing_support(integer,integer)'::regprocedure) INTO definition;
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Billing authority changed; review identity checks'; END IF;
 EXECUTE replace(definition,marker,marker||' AND u.pin_hash IS NOT NULL AND NOT coalesce(u.pin_reset_required,false) AND NOT coalesce(a.is_anonymous,false) AND d.full_auth_at>stamp-interval ''30 days'' AND d.last_pin_at>stamp-interval ''7 days''');
END $$;

CREATE FUNCTION rejoyce_security.support_billing_context(p_org uuid,p_ticket text,p_workforce_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE member rejoyce_security.support_workforce%rowtype; policy rejoyce_security.billing_grace_policies%rowtype;
 account rejoyce_security.organization_subscriptions%rowtype; org_name text; grace jsonb; version integer;
BEGIN
 SELECT * INTO member FROM rejoyce_security.support_workforce WHERE user_id=auth.uid() FOR SHARE;
 IF NOT FOUND OR NOT member.active OR member.role NOT IN ('billing','administrator') OR member.version IS DISTINCT FROM p_workforce_version THEN
  RAISE EXCEPTION 'Billing support authority unavailable' USING ERRCODE='42501'; END IF;
 -- Existing lookup independently checks live identity, device and AAL2, and atomically audits the read.
 PERFORM rejoyce_security.support_organization_lookup(p_org::text,p_ticket,p_workforce_version);
 SELECT name INTO org_name FROM public.organizations WHERE id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO policy FROM rejoyce_security.billing_grace_policies WHERE active;
 SELECT * INTO account FROM rejoyce_security.organization_subscriptions WHERE organization_id=p_org;
 SELECT s.version INTO version FROM rejoyce_security.billing_grace_state s WHERE organization_id=p_org;
 SELECT jsonb_build_object('id',g.id,'expiresAt',g.expires_at) INTO grace FROM rejoyce_security.billing_graces g
 JOIN rejoyce_security.billing_grace_policies p ON p.version=g.policy_version AND p.active
 WHERE g.organization_id=p_org AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND g.expires_at>clock_timestamp()
 ORDER BY g.expires_at DESC LIMIT 1;
 RETURN jsonb_build_object('userId',auth.uid(),'organizationId',p_org,'organizationName',org_name,'workforceVersion',member.version,'role',member.role,
 'managed',account.organization_id IS NOT NULL,'version',coalesce(version,0),'trialEndsAt',account.trial_ends_at,'paidThrough',account.paid_through,
 'grace',grace,'serverNow',clock_timestamp(),'policy',CASE WHEN policy.version IS NOT NULL THEN jsonb_build_object('version',policy.version,
 'maxDurationSeconds',policy.max_duration_seconds,'maxRenewals',policy.max_renewals,'requiresSecondApproval',policy.requires_second_approval,'stepupSeconds',policy.stepup_seconds) END);
END $$;
CREATE FUNCTION public.support_billing_context(p_org uuid,p_ticket text,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.support_billing_context(p_org,p_ticket,p_workforce_version) $$;

CREATE FUNCTION rejoyce_security.billing_grace_review_result(p_review uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'actorId',r.actor_id,'organizationId',r.organization_id,'request',r.request,'snapshot',r.snapshot,
 'validUntil',r.valid_until,'approved',EXISTS(SELECT 1 FROM rejoyce_security.billing_grace_approvals a WHERE a.review_id=r.id),
 'confirmed',r.operation_id IS NOT NULL,'serverNow',clock_timestamp())
 FROM rejoyce_security.billing_grace_reviews r WHERE r.id=p_review
$$;

CREATE FUNCTION rejoyce_security.prepare_billing_grace(p_action text,p_org uuid,p_grace uuid,p_expected_version integer,p_policy_version integer,
 p_expires timestamptz,p_ticket text,p_reason text,p_workforce_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy rejoyce_security.billing_grace_policies%rowtype; stamp timestamptz; version integer; review uuid; snapshot jsonb;
BEGIN
 policy:=rejoyce_security.require_billing_support(p_workforce_version,p_policy_version);
 IF p_action IS NULL OR p_action NOT IN ('grant','revoke') OR p_org IS NULL OR p_expected_version IS NULL OR p_expected_version<0
 OR p_ticket IS NULL OR p_ticket !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$' OR p_reason IS NULL OR p_reason NOT IN ('payment_recovery','pilot_support') THEN
  RAISE EXCEPTION 'Review organization, version, ticket and reason' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions WHERE organization_id=p_org) THEN
  RAISE EXCEPTION 'Managed organization required' USING ERRCODE='42501'; END IF;
 policy:=rejoyce_security.require_billing_support(p_workforce_version,p_policy_version);stamp:=clock_timestamp();
 SELECT s.version INTO version FROM rejoyce_security.billing_grace_state s WHERE organization_id=p_org;
 IF coalesce(version,0)<>p_expected_version THEN RAISE EXCEPTION 'Billing grace changed. Review again.' USING ERRCODE='40001'; END IF;
 IF p_action='grant' THEN
  IF p_grace IS NOT NULL OR p_expires IS NULL OR NOT isfinite(p_expires) OR p_expires<=stamp OR p_expires>stamp+make_interval(secs=>policy.max_duration_seconds) THEN
   RAISE EXCEPTION 'Expiry exceeds the approved grace policy' USING ERRCODE='22023'; END IF;
  IF rejoyce_security.active_billing_grace(p_org) IS NOT NULL THEN RAISE EXCEPTION 'Revoke the current grace before issuing another' USING ERRCODE='40001'; END IF;
  IF (SELECT count(*) FROM rejoyce_security.billing_graces WHERE organization_id=p_org)>policy.max_renewals THEN
   RAISE EXCEPTION 'Grace renewal limit reached' USING ERRCODE='42501'; END IF;
 ELSIF p_grace IS NULL OR p_expires IS NOT NULL OR NOT EXISTS(SELECT 1 FROM rejoyce_security.billing_graces WHERE id=p_grace AND organization_id=p_org AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'Grace unavailable' USING ERRCODE='42501';
 END IF;
 snapshot:=rejoyce_security.support_billing_context(p_org,p_ticket,p_workforce_version);
 INSERT INTO rejoyce_security.billing_grace_reviews(organization_id,actor_id,workforce_version,policy_version,request,snapshot,valid_until)
 VALUES(p_org,auth.uid(),p_workforce_version,policy.version,jsonb_build_object('action',p_action,'organization',p_org,'grace',p_grace,'version',p_expected_version,
 'policy',p_policy_version,'expires',p_expires,'ticket',p_ticket,'reason',p_reason),snapshot,stamp+make_interval(secs=>policy.stepup_seconds)) RETURNING id INTO review;
 INSERT INTO rejoyce_security.billing_grace_review_audit(review_id,actor_id,action) VALUES(review,auth.uid(),'prepared');
 RETURN rejoyce_security.billing_grace_review_result(review);
END $$;
CREATE FUNCTION public.prepare_billing_grace(p_action text,p_org uuid,p_grace uuid,p_expected_version integer,p_policy_version integer,
 p_expires timestamptz,p_ticket text,p_reason text,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.prepare_billing_grace(p_action,p_org,p_grace,p_expected_version,p_policy_version,p_expires,p_ticket,p_reason,p_workforce_version) $$;

CREATE FUNCTION rejoyce_security.inspect_billing_grace_review(p_review uuid,p_org uuid,p_approve boolean,p_workforce_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review rejoyce_security.billing_grace_reviews%rowtype; policy rejoyce_security.billing_grace_policies%rowtype; member rejoyce_security.support_workforce%rowtype;
BEGIN
 -- Verify workforce authority before looking up a potentially guessed review ID.
 SELECT * INTO member FROM rejoyce_security.support_workforce WHERE user_id=auth.uid();
 IF NOT FOUND OR NOT member.active OR member.role NOT IN ('billing','administrator') OR member.version IS DISTINCT FROM p_workforce_version THEN
  RAISE EXCEPTION 'Billing support authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO review FROM rejoyce_security.billing_grace_reviews WHERE id=p_review AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recovery review unavailable' USING ERRCODE='42501'; END IF;
 policy:=rejoyce_security.require_billing_support(p_workforce_version,review.policy_version);
 SELECT * INTO member FROM rejoyce_security.support_workforce WHERE user_id=auth.uid();
 IF review.valid_until<=clock_timestamp() OR review.operation_id IS NOT NULL OR p_approve IS NULL THEN
  RAISE EXCEPTION 'Recovery review expired or completed' USING ERRCODE='40001'; END IF;
 IF p_approve THEN
  IF member.role<>'administrator' OR review.actor_id=auth.uid() THEN RAISE EXCEPTION 'Independent support administrator required' USING ERRCODE='42501'; END IF;
  INSERT INTO rejoyce_security.billing_grace_approvals(review_id,approver_id,workforce_version,session_id)
  VALUES(review.id,auth.uid(),member.version,(auth.jwt()->>'session_id')::uuid) ON CONFLICT(review_id) DO NOTHING;
 END IF;
 INSERT INTO rejoyce_security.billing_grace_review_audit(review_id,actor_id,action) VALUES(review.id,auth.uid(),CASE WHEN p_approve THEN 'approved' ELSE 'viewed' END);
 RETURN rejoyce_security.billing_grace_review_result(review.id);
END $$;
CREATE FUNCTION public.inspect_billing_grace_review(p_review uuid,p_org uuid,p_approve boolean,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.inspect_billing_grace_review(p_review,p_org,p_approve,p_workforce_version) $$;

CREATE FUNCTION rejoyce_security.has_billing_grace_approval(p_org uuid,p_version integer,p_policy integer,p_expires timestamptz,p_ticket text,p_reason text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM rejoyce_security.billing_grace_review_permits p
 JOIN rejoyce_security.billing_grace_reviews r ON r.id=p.review_id JOIN rejoyce_security.billing_grace_approvals a ON a.review_id=r.id
 WHERE p.transaction_id=txid_current() AND p.actor_id=auth.uid() AND r.actor_id=auth.uid() AND r.organization_id=p_org
 AND r.valid_until>clock_timestamp() AND a.approver_id<>r.actor_id AND (r.request->>'expires')::timestamptz=p_expires AND r.request-'expires'=jsonb_build_object('action','grant','organization',p_org,'grace',NULL,
 'version',p_version,'policy',p_policy,'ticket',p_ticket,'reason',p_reason))
$$;
-- Only the reviewed wrapper below may invoke the old mutation implementation.
REVOKE ALL ON FUNCTION public.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer),
 rejoyce_security.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE definition text; marker text:='IF policy.requires_second_approval THEN'; BEGIN
 SELECT pg_get_functiondef('rejoyce_security.support_billing_grace(text,uuid,uuid,integer,integer,timestamptz,text,text,uuid,integer)'::regprocedure) INTO definition;
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Recovery writer changed; review approval enforcement'; END IF;
 EXECUTE replace(definition,marker,'IF policy.requires_second_approval AND NOT rejoyce_security.has_billing_grace_approval(p_org,p_expected_version,p_policy_version,p_expires,p_ticket,p_reason) THEN');
END $$;

CREATE FUNCTION rejoyce_security.confirm_billing_grace(p_review uuid,p_org uuid,p_operation uuid,p_workforce_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review rejoyce_security.billing_grace_reviews%rowtype; policy rejoyce_security.billing_grace_policies%rowtype;
 org uuid; v_result jsonb; approval rejoyce_security.billing_grace_approvals%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT organization_id INTO org FROM rejoyce_security.billing_grace_reviews WHERE id=p_review AND actor_id=auth.uid() AND organization_id=p_org;
 IF NOT FOUND OR p_operation IS NULL THEN RAISE EXCEPTION 'Recovery review unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO review FROM rejoyce_security.billing_grace_reviews WHERE id=p_review FOR UPDATE;
 policy:=rejoyce_security.require_billing_support(p_workforce_version,review.policy_version);
 IF review.workforce_version IS DISTINCT FROM p_workforce_version THEN RAISE EXCEPTION 'Workforce authority changed. Review again.' USING ERRCODE='40001'; END IF;
 IF review.operation_id IS NOT NULL THEN
  IF review.operation_id<>p_operation THEN RAISE EXCEPTION 'Recovery review already confirmed' USING ERRCODE='40001'; END IF;
  RETURN review.result;
 END IF;
 IF review.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'Recovery review expired' USING ERRCODE='40001'; END IF;
 IF policy.requires_second_approval AND review.request->>'action'='grant' THEN
  SELECT * INTO approval FROM rejoyce_security.billing_grace_approvals WHERE review_id=review.id;
  IF NOT FOUND OR approval.approver_id=auth.uid() THEN RAISE EXCEPTION 'Independent approval required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM rejoyce_security.support_workforce m JOIN auth.users a ON a.id=m.user_id
  JOIN auth.sessions s ON s.user_id=a.id AND s.id=approval.session_id
  JOIN public.users u ON u.id=a.id JOIN public.device_sessions d ON d.session_id=s.id AND d.user_id=a.id
  WHERE m.user_id=approval.approver_id AND m.active AND m.role='administrator' AND m.version=approval.workforce_version
  AND u.status='active' AND (a.banned_until IS NULL OR a.banned_until<=clock_timestamp())
  AND u.pin_hash IS NOT NULL AND NOT coalesce(u.pin_reset_required,false) AND NOT coalesce(a.is_anonymous,false)
  AND d.full_auth_at>clock_timestamp()-interval '30 days' AND d.last_pin_at>clock_timestamp()-interval '7 days'
  AND s.aal='aal2' AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) AND NOT d.revoked AND d.unlocked_until>clock_timestamp()
  FOR SHARE OF m,a,s,u,d;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approver authority changed. Prepare a new review.' USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO rejoyce_security.billing_grace_review_permits VALUES(txid_current(),review.id,auth.uid());
 v_result:=rejoyce_security.support_billing_grace(review.request->>'action',org,(review.request->>'grace')::uuid,(review.request->>'version')::integer,
 review.policy_version,(review.request->>'expires')::timestamptz,review.request->>'ticket',review.request->>'reason',p_operation,p_workforce_version);
 DELETE FROM rejoyce_security.billing_grace_review_permits WHERE transaction_id=txid_current() AND review_id=review.id;
 INSERT INTO rejoyce_security.billing_grace_notices(organization_id,version,action,expires_at)
 VALUES(org,(v_result->>'version')::integer,v_result->>'action',(v_result->>'expiresAt')::timestamptz);
 INSERT INTO rejoyce_security.billing_grace_review_audit(review_id,actor_id,action) VALUES(review.id,auth.uid(),'confirmed');
 UPDATE rejoyce_security.billing_grace_reviews SET operation_id=p_operation,result=v_result WHERE id=review.id;
 RETURN v_result;
END $$;
CREATE FUNCTION public.confirm_billing_grace(p_review uuid,p_org uuid,p_operation uuid,p_workforce_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.confirm_billing_grace(p_review,p_org,p_operation,p_workforce_version) $$;

ALTER FUNCTION rejoyce_security.subscription_access(uuid) RENAME TO subscription_access_before_recovery_review;
CREATE FUNCTION rejoyce_security.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; notices jsonb:='[]'; BEGIN
 result:=rejoyce_security.subscription_access_before_recovery_review(p_session_id);
 IF coalesce((result->>'canManageBilling')::boolean,false) THEN
  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.version DESC),'[]') INTO notices FROM
  (SELECT version,action,expires_at AS "expiresAt",created_at AS "createdAt" FROM rejoyce_security.billing_grace_notices
   WHERE organization_id=public.current_organization_id() ORDER BY version DESC LIMIT 10) n;
 END IF;
 RETURN result||jsonb_build_object('billingNotices',notices);
END $$;
CREATE OR REPLACE FUNCTION public.subscription_access(p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.subscription_access(p_session_id) $$;
REVOKE ALL ON FUNCTION rejoyce_security.subscription_access_before_recovery_review(uuid),rejoyce_security.subscription_access(uuid),
 rejoyce_security.billing_grace_review_result(uuid),rejoyce_security.has_billing_grace_approval(uuid,integer,integer,timestamptz,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rejoyce_security.subscription_access(uuid) TO authenticated;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','rejoyce_security') AND p.proname IN ('support_billing_context','prepare_billing_grace','inspect_billing_grace_review','confirm_billing_grace') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',item.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',item.signature);
 END LOOP;
END $$;
COMMIT;
