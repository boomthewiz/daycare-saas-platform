-- Stage first; enable only after the application and email callback are verified.
CREATE SCHEMA rejoyce_security;
REVOKE ALL ON SCHEMA rejoyce_security FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA rejoyce_security TO authenticated, service_role;
CREATE TABLE rejoyce_security.session_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enforced boolean NOT NULL DEFAULT false
);
INSERT INTO rejoyce_security.session_policy DEFAULT VALUES;
CREATE TABLE public.device_sessions (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_auth_at timestamptz NOT NULL,
  last_pin_at timestamptz NOT NULL,
  unlocked_until timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE public.email_login_challenges (
  proof_hash text PRIMARY KEY CHECK(proof_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX email_login_challenges_expiry ON public.email_login_challenges(created_at);
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_login_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_sessions, public.email_login_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_sessions, public.email_login_challenges TO service_role;
CREATE POLICY server_only ON public.device_sessions TO service_role USING(true) WITH CHECK(true);
CREATE POLICY server_only ON public.email_login_challenges TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON ALL TABLES IN SCHEMA rejoyce_security FROM PUBLIC, anon, authenticated;

CREATE FUNCTION rejoyce_security.session_is_unlocked() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT NOT (SELECT enforced FROM rejoyce_security.session_policy WHERE singleton)
    OR EXISTS (
      SELECT 1 FROM public.device_sessions d
      JOIN auth.sessions s ON s.id=d.session_id AND s.user_id=d.user_id
      JOIN public.users u ON u.id=d.user_id
      WHERE d.user_id=auth.uid() AND d.session_id::text=auth.jwt()->>'session_id'
        AND NOT d.revoked AND u.status='active' AND u.pin_hash IS NOT NULL
        AND NOT coalesce(u.pin_reset_required,false)
        AND d.full_auth_at > statement_timestamp()-interval '30 days'
        AND d.last_pin_at > statement_timestamp()-interval '7 days'
        AND d.unlocked_until > statement_timestamp()
        AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
    );
$function$;
REVOKE ALL ON FUNCTION rejoyce_security.session_is_unlocked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.session_is_unlocked() TO authenticated, service_role;

CREATE FUNCTION rejoyce_security.require_unlocked() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT rejoyce_security.session_is_unlocked() THEN
    RAISE EXCEPTION 'PIN unlock or full sign-in required' USING ERRCODE='42501';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION rejoyce_security.require_unlocked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.require_unlocked() TO authenticated, service_role;

-- The API passes identity only after verifying the bearer token. Browser roles
-- cannot call this privileged state machine or choose another session's identity.
CREATE FUNCTION public.manage_device_session(p_user_id uuid, p_session_id uuid, p_action text, p_proof_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  d public.device_sessions%rowtype;
  a auth.sessions%rowtype;
  u public.users%rowtype;
  challenge public.email_login_challenges%rowtype;
  at_time timestamptz := clock_timestamp();
  state text;
BEGIN
  IF p_action NOT IN ('status','activity','lock','unlock','logout','complete_email','setup') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  SELECT * INTO a FROM auth.sessions WHERE id=p_session_id AND user_id=p_user_id;
  IF NOT FOUND OR (a.not_after IS NOT NULL AND a.not_after <= at_time) THEN
    RETURN jsonb_build_object('state','full_login');
  END IF;
  SELECT * INTO u FROM public.users WHERE id=p_user_id;
  IF NOT FOUND OR u.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('state','inactive');
  END IF;
  IF p_action='complete_email' THEN
    DELETE FROM public.email_login_challenges WHERE proof_hash IN (
      SELECT proof_hash FROM public.email_login_challenges WHERE created_at <= at_time-interval '1 hour'
      ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
    );
    DELETE FROM public.email_login_challenges
      WHERE proof_hash=p_proof_hash AND user_id=p_user_id
        AND created_at > at_time-interval '1 hour'
        AND a.created_at >= created_at-interval '5 seconds'
      RETURNING * INTO challenge;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','full_login'); END IF;
    INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
      VALUES(p_session_id,p_user_id,at_time,at_time,at_time+interval '5 minutes')
      ON CONFLICT(session_id) DO UPDATE SET full_auth_at=excluded.full_auth_at,
        last_pin_at=excluded.last_pin_at,unlocked_until=excluded.unlocked_until,revoked=false;
  END IF;
  SELECT * INTO d FROM public.device_sessions WHERE session_id=p_session_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR d.revoked OR d.full_auth_at <= at_time-interval '30 days'
      OR d.last_pin_at <= at_time-interval '7 days' THEN
    RETURN jsonb_build_object('state','full_login');
  END IF;
  IF p_action='logout' THEN
    UPDATE public.device_sessions SET revoked=true,unlocked_until=at_time WHERE session_id=p_session_id;
    RETURN jsonb_build_object('state','full_login');
  END IF;
  IF p_action='lock' THEN
    UPDATE public.device_sessions SET unlocked_until=at_time WHERE session_id=p_session_id;
    d.unlocked_until := at_time;
  ELSIF p_action='unlock' THEN
    -- Called only after a rate-limited server-side PIN check.
    IF u.pin_hash IS NULL OR coalesce(u.pin_reset_required,false) THEN
      RETURN jsonb_build_object('state','setup');
    END IF;
    UPDATE public.device_sessions SET last_pin_at=at_time,unlocked_until=at_time+interval '5 minutes'
      WHERE session_id=p_session_id RETURNING * INTO d;
  ELSIF p_action='activity' AND d.unlocked_until > at_time THEN
    UPDATE public.device_sessions SET unlocked_until=at_time+interval '5 minutes'
      WHERE session_id=p_session_id RETURNING * INTO d;
  END IF;
  state := CASE WHEN u.pin_hash IS NULL OR coalesce(u.pin_reset_required,false) THEN 'setup'
                WHEN d.unlocked_until > at_time THEN 'unlocked' ELSE 'locked' END;
  RETURN jsonb_build_object('state',state,'serverNow',at_time,'unlockedUntil',d.unlocked_until,
    'fullAuthUntil',d.full_auth_at+interval '30 days','pinRequiredBy',d.last_pin_at+interval '7 days',
    'canSetPin',d.full_auth_at > at_time-interval '10 minutes');
END
$function$;
REVOKE ALL ON FUNCTION public.manage_device_session(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_device_session(uuid,uuid,text,text) TO service_role;

-- Restrictive policies supplement every existing tenant/role policy; they grant
-- no access themselves and do not alter the service-role integrations.
DO $policies$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename NOT IN ('pin_login_attempts','device_sessions','email_login_challenges') LOOP
    EXECUTE format('CREATE POLICY require_unlocked_device ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((select rejoyce_security.session_is_unlocked())) WITH CHECK ((select rejoyce_security.session_is_unlocked()))', t.tablename);
  END LOOP;
END
$policies$;

-- RPC guards are appended below from inspected live definitions, preserving
-- signatures, return types, ownership, grants and existing tenant checks.
CREATE OR REPLACE FUNCTION public.approve_session_note(p_note_id uuid, p_review_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_organization_id uuid;
  v_status text;
begin
  PERFORM rejoyce_security.require_unlocked();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;


  if not public.can_review_sessions() then
    raise exception
      'You do not have permission to review session documentation';
  end if;


  select
    sn.organization_id,
    sn.status
  into
    v_organization_id,
    v_status
  from public.session_notes sn
  where sn.id = p_note_id;


  if v_organization_id is null then
    raise exception 'Session note not found';
  end if;


  if v_organization_id is distinct from
     public.current_organization_id()
  then
    raise exception 'Session note does not belong to your organization';
  end if;


  if v_status <> 'submitted' then
    raise exception
      'Only submitted session notes can be approved';
  end if;


  update public.session_notes
  set
    status = 'approved',
    review_notes =
      case
        when p_review_notes is null
          or length(trim(p_review_notes)) = 0
        then review_notes
        else trim(p_review_notes)
      end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_note_id
    and organization_id =
        public.current_organization_id()
    and status = 'submitted';


  if not found then
    raise exception
      'Session note could not be approved';
  end if;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_client(requested_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.clients as c
    where c.id = requested_client_id
      and c.organization_id =
        public.current_organization_id()
      and (
        public.can_manage_clients()
        or public.can_manage_sessions()
        or c.assigned_provider_id = auth.uid()
        or exists (
          select 1
          from public.sessions as s
          where s.client_id = c.id
            and s.provider_id = auth.uid()
        )
      )
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    public.is_organization_owner()
    or public.can_view_reports()) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_assign_org_role(requested_role text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_role text;
begin
  PERFORM rejoyce_security.require_unlocked();

  if not public.can_manage_users() then
    return false;
  end if;

  caller_role :=
    public.current_user_role();

  -- Owner is NEVER assigned through the ordinary
  -- team-management workflow.
  if requested_role = 'owner' then
    return false;
  end if;

  if requested_role not in (
    'admin',
    'manager',
    'director',
    'therapist',
    'teacher',
    'educator',
    'assistant',
    'aide',
    'caregiver',
    'staff'
  ) then
    return false;
  end if;

  -- Only owners/admins can create another admin.
  if requested_role = 'admin' then
    return caller_role in (
      'owner',
      'admin'
    );
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_billing()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_billing')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_clients()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_clients')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_org_user(requested_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as target
    where target.id = requested_user_id
      and target.organization_id =
        public.current_organization_id()

      and public.can_manage_users()

      -- Owner accounts are never changed through the normal
      -- People / Team Member management workflow.
      and target.role <> 'owner'

      -- Prevent editing your own role/status/permissions through
      -- the normal team-admin flow. Profile fields can be handled
      -- separately.
      and target.id <> auth.uid()
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_requested_user(requested_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.can_manage_org_user(
    requested_user_id
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_sessions()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_sessions')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_users()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_users')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_review_session_data()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    left join public.user_permissions as p
      on p.user_id = u.id
    where u.id = (select auth.uid())
      and u.status = 'active'
      and (
        u.role in (
          'owner',
          'admin',
          'director',
          'manager'
        )
        or coalesce(p.can_review_sessions, false)
        or coalesce(p.can_view_reports, false)
      )
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_review_sessions()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('review_sessions')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('view_reports')) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_prepared_session(requested_client_id uuid, requested_provider_id uuid, requested_scheduled_start timestamp with time zone, requested_scheduled_end timestamp with time zone, requested_session_type text DEFAULT 'direct_therapy'::text, requested_location text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_org_id uuid;
  selected_client public.clients%rowtype;
  selected_provider public.users%rowtype;
  created_session public.sessions%rowtype;
  inserted_target_count integer;
begin
  PERFORM rejoyce_security.require_unlocked();
  -- Only administrators or users with the appropriate
  -- organization-management permission may create sessions.
  if auth.uid() is null or not public.can_manage_sessions() then
    raise exception
      'You are not authorized to create sessions';
  end if;

  current_org_id :=
    public.current_organization_id();

  if current_org_id is null then
    raise exception
      'Your account is not connected to an organization';
  end if;

  if requested_client_id is null then
    raise exception 'A client is required';
  end if;

  if requested_provider_id is null then
    raise exception 'A provider is required';
  end if;

  if requested_scheduled_start is null
    or requested_scheduled_end is null
  then
    raise exception
      'A start and end time are required';
  end if;

  if requested_scheduled_end
    <= requested_scheduled_start
  then
    raise exception
      'The session end must be after its start';
  end if;

  -- Confirm the client belongs to the admin's organization.
  select *
  into selected_client
  from public.clients
  where id = requested_client_id
    and organization_id = current_org_id
    and status = 'active';

  if not found then
    raise exception
      'Client not found, inactive, or outside your organization';
  end if;

  -- Confirm the assigned provider belongs to the same
  -- organization and has an active account.
  select *
  into selected_provider
  from public.users
  where id = requested_provider_id
    and organization_id = current_org_id
    and status = 'active';

  if not found then
    raise exception
      'Provider not found, inactive, or outside your organization';
  end if;

  -- Create the session.
  insert into public.sessions (
    organization_id,
    client_id,
    provider_id,
    session_type,
    status,
    attendance_status,
    scheduled_start,
    scheduled_end,
    location,
    prepared_by,
    prepared_at
  )
  values (
    current_org_id,
    selected_client.id,
    selected_provider.id,
    coalesce(
      nullif(trim(requested_session_type), ''),
      'direct_therapy'
    ),
    'confirmed',
    'unconfirmed',
    requested_scheduled_start,
    requested_scheduled_end,
    nullif(trim(requested_location), ''),
    auth.uid(),
    now()
  )
  returning *
  into created_session;

  -- Copy the client's active targets into this session.
  insert into public.session_targets (
    organization_id,
    session_id,
    client_target_id,
    title,
    instruction,
    category,
    target_type,
    response_mode,
    materials,
    sort_order,
    status
  )
  select
    ct.organization_id,
    created_session.id,
    ct.id,
    ct.title,
    ct.instruction,
    ct.category,
    ct.target_type,
    ct.response_mode,
    ct.materials,
    ct.sort_order,
    'pending'
  from public.client_targets as ct
  where ct.client_id = selected_client.id
    and ct.organization_id = current_org_id
    and ct.status = 'active'
  order by ct.sort_order;

  get diagnostics inserted_target_count = row_count;

  return jsonb_build_object(
    'session_id',
      created_session.id,
    'client_id',
      created_session.client_id,
    'provider_id',
      created_session.provider_id,
    'scheduled_start',
      created_session.scheduled_start,
    'scheduled_end',
      created_session.scheduled_end,
    'status',
      created_session.status,
    'targets_added',
      inserted_target_count
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select u.organization_id
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1) ELSE NULL::uuid END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select u.role
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1) ELSE NULL::text END;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_assigned_session(requested_session_id uuid)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_assigned_to_session(requested_session_id) then
    raise exception 'You are not assigned to this session';
  end if;

  update public.sessions
  set
    total_paused_seconds =
      total_paused_seconds +
      case
        when paused_at is not null then
          greatest(
            0,
            extract(
              epoch from (now() - paused_at)
            )::integer
          )
        else 0
      end,
    status = 'completed',
    completed_at = now(),
    paused_at = null,
    updated_at = now()
  where id = requested_session_id
    and status in (
      'in_progress',
      'paused'
    )
  returning *
  into updated_session;

  if not found then
    raise exception
      'Only an active or paused session can be completed';
  end if;

  return updated_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_org_permission(requested_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_org uuid;
  user_role text;
  permission_granted boolean := false;
begin
  PERFORM rejoyce_security.require_unlocked();

  select
    u.organization_id,
    u.role
  into
    user_org,
    user_role
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1;

  if user_org is null then
    return false;
  end if;

  -- Organization owner always has full organization authority.
  if user_role = 'owner' then
    return true;
  end if;

  select
    case requested_permission

      when 'manage_users'
        then coalesce(p.can_manage_users, false)

      when 'manage_clients'
        then coalesce(p.can_manage_clients, false)

      when 'manage_sessions'
        then coalesce(p.can_manage_sessions, false)

      when 'review_sessions'
        then coalesce(p.can_review_sessions, false)

      when 'view_reports'
        then coalesce(p.can_view_reports, false)

      when 'manage_billing'
        then coalesce(p.can_manage_billing, false)

      else false
    end

  into permission_granted

  from public.user_permissions as p
  where p.user_id = auth.uid()
    and p.organization_id = user_org
  limit 1;

  return coalesce(permission_granted, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_assigned_session_provider(requested_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    where s.id = requested_session_id
      and s.provider_id = auth.uid()
      and s.organization_id =
        public.current_organization_id()
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_assigned_to_client(requested_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    join public.users as u
      on u.id = (select auth.uid())
    where s.client_id = requested_client_id
      and s.provider_id = u.id
      and s.organization_id = u.organization_id
      and u.status = 'active'
      and s.status in (
        'scheduled',
        'confirmed',
        'in_progress',
        'paused',
        'completed'
      )
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_assigned_to_session(requested_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    join public.users as u
      on u.id = (select auth.uid())
    where s.id = requested_session_id
      and s.provider_id = u.id
      and s.organization_id = u.organization_id
      and u.status = 'active'
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_frontline_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    where u.id = (select auth.uid())
      and u.status = 'active'
      and u.role in (
        'therapist',
        'teacher',
        'educator',
        'assistant',
        'aide',
        'caregiver',
        'staff'
      )
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_organization_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    public.is_organization_owner()
    or public.can_manage_users()
    or public.can_manage_clients()
    or public.can_manage_sessions()
    or public.can_review_sessions()
    or public.can_view_reports()
    or public.can_manage_billing()) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_organization_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    where u.id = auth.uid()
      and u.role = 'owner'
      and coalesce(u.status, 'active') = 'active'
      and u.organization_id is not null
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_same_organization(requested_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    requested_organization_id is not null
    and requested_organization_id =
      public.current_organization_id()) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_user_org_owner(requested_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    where u.id = requested_user_id
      and u.organization_id =
        public.current_organization_id()
      and u.role = 'owner'
  )) ELSE false END;
$function$
;

CREATE OR REPLACE FUNCTION public.lock_session_note(p_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_organization_id uuid;
  v_status text;
begin
  PERFORM rejoyce_security.require_unlocked();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;


  if not public.can_review_sessions() then
    raise exception
      'You do not have permission to lock session documentation';
  end if;


  select
    sn.organization_id,
    sn.status
  into
    v_organization_id,
    v_status
  from public.session_notes sn
  where sn.id = p_note_id;


  if v_organization_id is null then
    raise exception 'Session note not found';
  end if;


  if v_organization_id is distinct from
     public.current_organization_id()
  then
    raise exception 'Session note does not belong to your organization';
  end if;


  if v_status <> 'approved' then
    raise exception
      'Only approved session notes can be locked';
  end if;


  update public.session_notes
  set
    status = 'locked',
    updated_at = now()
  where id = p_note_id
    and organization_id =
        public.current_organization_id()
    and status = 'approved';


  if not found then
    raise exception
      'Session note could not be locked';
  end if;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.pause_assigned_session(requested_session_id uuid)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_assigned_to_session(requested_session_id) then
    raise exception 'You are not assigned to this session';
  end if;

  update public.sessions
  set
    status = 'paused',
    paused_at = now(),
    updated_at = now()
  where id = requested_session_id
    and status = 'in_progress'
  returning *
  into updated_session;

  if not found then
    raise exception
      'Only an active session can be paused';
  end if;

  return updated_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_session_targets(requested_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_session public.sessions%rowtype;
  inserted_count integer;
begin
  PERFORM rejoyce_security.require_unlocked();
  if auth.uid() is null or not public.can_manage_sessions() then
    raise exception 'Session management permission required' using errcode = '42501';
  end if;
  select *
  into selected_session
  from public.sessions
  where id = requested_session_id
    and organization_id = public.current_organization_id()
  for update;

  if not found then
    raise exception 'Session not found';
  end if;

  insert into public.session_targets (
    organization_id,
    session_id,
    client_target_id,
    title,
    instruction,
    category,
    target_type,
    response_mode,
    materials,
    sort_order,
    status
  )
  select
    ct.organization_id,
    selected_session.id,
    ct.id,
    ct.title,
    ct.instruction,
    ct.category,
    ct.target_type,
    ct.response_mode,
    ct.materials,
    ct.sort_order,
    'pending'
  from public.client_targets ct
  where ct.client_id = selected_session.client_id
    and ct.organization_id = selected_session.organization_id
    and ct.status = 'active'
  on conflict (session_id, client_target_id)
  do nothing;

  get diagnostics inserted_count = row_count;

  update public.sessions
  set
    prepared_by = auth.uid(),
    prepared_at = now(),
    updated_at = now()
  where id = requested_session_id;

  return inserted_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_behavior_event(requested_session_id uuid, requested_client_behavior_id uuid, requested_duration_seconds integer DEFAULT NULL::integer, requested_intensity_level integer DEFAULT NULL::integer, requested_notes text DEFAULT NULL::text)
 RETURNS behavior_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_session public.sessions%rowtype;
  selected_behavior public.client_behaviors%rowtype;
  inserted_event public.behavior_events%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  -- Confirm the user is assigned to the requested session.
  if not public.is_assigned_to_session(
    requested_session_id
  ) then
    raise exception
      'You are not assigned to this session';
  end if;

  -- Load the session.
  select *
  into selected_session
  from public.sessions
  where id = requested_session_id;

  if not found then
    raise exception 'Session not found';
  end if;

  -- Only allow data collection while the session is active.
  if selected_session.status not in (
    'in_progress',
    'paused'
  ) then
    raise exception
      'Behavior events can only be recorded during an active session';
  end if;

  -- Load the behavior definition.
  select *
  into selected_behavior
  from public.client_behaviors
  where id = requested_client_behavior_id;

  if not found then
    raise exception 'Behavior definition not found';
  end if;

  -- Confirm the behavior belongs to the session's client.
  if selected_behavior.client_id
    is distinct from selected_session.client_id
  then
    raise exception
      'This behavior does not belong to the session client';
  end if;

  -- Confirm organization isolation.
  if selected_behavior.organization_id
      is distinct from selected_session.organization_id
    or selected_session.organization_id
      is distinct from public.current_organization_id()
  then
    raise exception
      'Behavior or session is outside your organization';
  end if;

  -- Confirm the behavior is still active.
  if selected_behavior.active is not true then
    raise exception
      'This behavior definition is inactive';
  end if;

  -- Validate optional duration.
  if requested_duration_seconds is not null
    and requested_duration_seconds < 0
  then
    raise exception
      'Duration cannot be negative';
  end if;

  -- Validate optional intensity.
  if requested_intensity_level is not null
    and requested_intensity_level not between 1 and 5
  then
    raise exception
      'Intensity must be between 1 and 5';
  end if;

  -- Create one immutable event for this recorded occurrence.
  insert into public.behavior_events (
    organization_id,
    session_id,
    client_behavior_id,
    provider_id,
    behavior_name,
    event_type,
    count,
    duration_seconds,
    intensity_level,
    notes,
    occurred_at
  )
  values (
    selected_session.organization_id,
    selected_session.id,
    selected_behavior.id,
    auth.uid(),
    selected_behavior.name,
    selected_behavior.measurement_type,
    1,
    requested_duration_seconds,
    requested_intensity_level,
    nullif(trim(requested_notes), ''),
    now()
  )
  returning *
  into inserted_event;

  return inserted_event;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_target_response(requested_session_target_id uuid, requested_result text, requested_prompt_level text DEFAULT NULL::text, requested_notes text DEFAULT NULL::text)
 RETURNS target_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_target public.session_targets%rowtype;
  next_trial_number integer;
  inserted_response public.target_responses%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  -- Confirm this is an allowed response value.
  if requested_result not in (
    'independent',
    'prompted',
    'retry',
    'correct',
    'incorrect',
    'skipped',
    'not_applicable'
  ) then
    raise exception 'Invalid target response result';
  end if;

  -- Load the prepared target.
  select *
  into selected_target
  from public.session_targets
  where id = requested_session_target_id;

  if not found then
    raise exception 'Session target not found';
  end if;

  -- Confirm the signed-in user is assigned to its session.
  if not public.is_assigned_to_session(
    selected_target.session_id
  ) then
    raise exception
      'You are not assigned to this session';
  end if;

  -- Ensure the target belongs to the signed-in user's organization.
  if selected_target.organization_id
    is distinct from public.current_organization_id()
  then
    raise exception
      'Session target is outside your organization';
  end if;

  -- Do not allow responses after the session is completed.
  if exists (
    select 1
    from public.sessions s
    where s.id = selected_target.session_id
      and s.status not in (
        'in_progress',
        'paused'
      )
  ) then
    raise exception
      'Responses can only be recorded during an active session';
  end if;

  -- Calculate the next trial number for this target.
  select coalesce(max(trial_number), 0) + 1
  into next_trial_number
  from public.target_responses
  where session_target_id =
    requested_session_target_id;

  -- Insert the raw response.
  insert into public.target_responses (
    organization_id,
    session_id,
    session_target_id,
    provider_id,
    result,
    prompt_level,
    trial_number,
    notes,
    recorded_at
  )
  values (
    selected_target.organization_id,
    selected_target.session_id,
    selected_target.id,
    auth.uid(),
    requested_result,
    nullif(trim(requested_prompt_level), ''),
    next_trial_number,
    nullif(trim(requested_notes), ''),
    now()
  )
  returning *
  into inserted_response;

  -- Update the prepared target's visible state.
  update public.session_targets
  set
    status = case
      when requested_result = 'skipped'
        then 'skipped'
      when requested_result = 'retry'
        then 'active'
      else 'completed'
    end,
    completed_at = case
      when requested_result in (
        'independent',
        'prompted',
        'correct',
        'incorrect',
        'not_applicable'
      )
        then now()
      else null
    end,
    updated_at = now()
  where id = requested_session_target_id;

  return inserted_response;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resume_assigned_session(requested_session_id uuid)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_assigned_to_session(requested_session_id) then
    raise exception 'You are not assigned to this session';
  end if;

  update public.sessions
  set
    total_paused_seconds =
      total_paused_seconds +
      greatest(
        0,
        extract(
          epoch from (now() - paused_at)
        )::integer
      ),
    status = 'in_progress',
    paused_at = null,
    updated_at = now()
  where id = requested_session_id
    and status = 'paused'
    and paused_at is not null
  returning *
  into updated_session;

  if not found then
    raise exception
      'Only a paused session can be resumed';
  end if;

  return updated_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.return_session_note_for_correction(p_note_id uuid, p_review_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_organization_id uuid;
  v_status text;
begin
  PERFORM rejoyce_security.require_unlocked();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;


  if not public.can_review_sessions() then
    raise exception
      'You do not have permission to review session documentation';
  end if;


  if p_review_notes is null
     or length(trim(p_review_notes)) = 0
  then
    raise exception
      'Reviewer feedback is required when returning a note';
  end if;


  select
    sn.organization_id,
    sn.status
  into
    v_organization_id,
    v_status
  from public.session_notes sn
  where sn.id = p_note_id;


  if v_organization_id is null then
    raise exception 'Session note not found';
  end if;


  if v_organization_id is distinct from
     public.current_organization_id()
  then
    raise exception 'Session note does not belong to your organization';
  end if;


  if v_status <> 'submitted' then
    raise exception
      'Only submitted session notes can be returned';
  end if;


  update public.session_notes
  set
    status = 'returned',
    review_notes = trim(p_review_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_note_id
    and organization_id =
        public.current_organization_id()
    and status = 'submitted';


  if not found then
    raise exception
      'Session note could not be returned';
  end if;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_assigned_session_note_draft(requested_session_id uuid, requested_therapist_addendum text DEFAULT NULL::text, requested_final_note text DEFAULT NULL::text)
 RETURNS session_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_session public.sessions%rowtype;
  existing_note public.session_notes%rowtype;
  saved_note public.session_notes%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  -- Confirm the signed-in user is frontline staff.
  if not public.is_frontline_staff() then
    raise exception 'Frontline staff access is required';
  end if;

  -- Confirm assignment.
  if not public.is_assigned_to_session(
    requested_session_id
  ) then
    raise exception
      'You are not assigned to this session';
  end if;

  -- Load the session.
  select *
  into selected_session
  from public.sessions
  where id = requested_session_id
    and organization_id =
      public.current_organization_id();

  if not found then
    raise exception
      'Session not found or is outside your organization';
  end if;

  -- Notes may be prepared during or after a session,
  -- but not for canceled or absent sessions in this MVP.
  if selected_session.status not in (
    'in_progress',
    'paused',
    'completed'
  ) then
    raise exception
      'A note cannot be created for this session status';
  end if;

  -- Check for an existing note.
  select *
  into existing_note
  from public.session_notes
  where session_id = requested_session_id
  for update;

  if not found then
    -- Create the initial draft.
    insert into public.session_notes (
      organization_id,
      session_id,
      author_id,
      status,
      client_present,
      provider_present,
      supervisor_present,
      structured_summary,
      therapist_addendum,
      final_note
    )
    values (
      selected_session.organization_id,
      selected_session.id,
      auth.uid(),
      'draft',
      selected_session.attendance_status = 'present',
      selected_session.started_at is not null,
      selected_session.was_supervised,
      jsonb_build_object(
        'session_status',
          selected_session.status,
        'scheduled_start',
          selected_session.scheduled_start,
        'scheduled_end',
          selected_session.scheduled_end,
        'started_at',
          selected_session.started_at,
        'completed_at',
          selected_session.completed_at,
        'total_paused_seconds',
          selected_session.total_paused_seconds
      ),
      nullif(
        trim(requested_therapist_addendum),
        ''
      ),
      nullif(
        trim(requested_final_note),
        ''
      )
    )
    returning *
    into saved_note;

    return saved_note;
  end if;

  -- Only the original author may edit the draft.
  if existing_note.author_id
    is distinct from auth.uid()
  then
    raise exception
      'You are not the author of this session note';
  end if;

  -- Submitted and finalized notes cannot be edited.
  if existing_note.status not in (
    'draft',
    'returned'
  ) then
    raise exception
      'This session note can no longer be edited';
  end if;

  update public.session_notes
  set
    client_present =
      selected_session.attendance_status = 'present',

    provider_present =
      selected_session.started_at is not null,

    supervisor_present =
      selected_session.was_supervised,

    structured_summary =
      coalesce(
        structured_summary,
        '{}'::jsonb
      )
      || jsonb_build_object(
        'session_status',
          selected_session.status,
        'scheduled_start',
          selected_session.scheduled_start,
        'scheduled_end',
          selected_session.scheduled_end,
        'started_at',
          selected_session.started_at,
        'completed_at',
          selected_session.completed_at,
        'total_paused_seconds',
          selected_session.total_paused_seconds
      ),

    therapist_addendum =
      nullif(
        trim(requested_therapist_addendum),
        ''
      ),

    final_note =
      nullif(
        trim(requested_final_note),
        ''
      ),

    -- A returned note becomes a working draft again.
    status = 'draft',

    updated_at = now()
  where id = existing_note.id
    and organization_id = public.current_organization_id()
    and author_id = auth.uid()
    and status in ('draft', 'returned')
  returning *
  into saved_note;

  return saved_note;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_assigned_session(requested_session_id uuid)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_frontline_staff() then
    raise exception 'Frontline staff access is required';
  end if;

  if not public.is_assigned_to_session(requested_session_id) then
    raise exception 'You are not assigned to this session';
  end if;

  update public.sessions
  set
    status = 'in_progress',
    attendance_status = case
      when attendance_status = 'unconfirmed'
        then 'present'
      else attendance_status
    end,
    started_at = coalesce(started_at, now()),
    paused_at = null,
    updated_at = now()
  where id = requested_session_id
    and status in (
      'scheduled',
      'confirmed',
      'paused'
    )
  returning *
  into updated_session;

  if not found then
    raise exception
      'Session cannot be started from its current status';
  end if;

  return updated_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_assigned_session_note(requested_session_id uuid)
 RETURNS session_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_note public.session_notes%rowtype;
  submitted_note public.session_notes%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_frontline_staff() then
    raise exception 'Frontline staff access is required';
  end if;

  if not public.is_assigned_to_session(
    requested_session_id
  ) then
    raise exception
      'You are not assigned to this session';
  end if;

  select *
  into selected_note
  from public.session_notes
  where session_id = requested_session_id
  for update;

  if not found then
    raise exception
      'Create and save the session note before submitting it';
  end if;

  if selected_note.author_id
    is distinct from auth.uid()
  then
    raise exception
      'You are not the author of this session note';
  end if;

  if selected_note.status not in (
    'draft',
    'returned'
  ) then
    raise exception
      'This session note has already been submitted or finalized';
  end if;

  if coalesce(
    nullif(trim(selected_note.final_note), ''),
    nullif(trim(selected_note.generated_note), ''),
    nullif(trim(selected_note.therapist_addendum), '')
  ) is null then
    raise exception
      'The session note must contain documentation before submission';
  end if;

  update public.session_notes
  set
    status = 'submitted',
    submitted_at = now(),
    updated_at = now()
  where id = selected_note.id
    and organization_id = public.current_organization_id()
    and author_id = auth.uid()
    and status in ('draft', 'returned')
  returning *
  into submitted_note;

  return submitted_note;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_session_note_for_review(p_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_organization_id uuid;
  v_status text;
begin
  PERFORM rejoyce_security.require_unlocked();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;


  select
    sn.session_id,
    sn.organization_id,
    sn.status
  into
    v_session_id,
    v_organization_id,
    v_status
  from public.session_notes sn
  where sn.id = p_note_id;


  if v_session_id is null then
    raise exception 'Session note not found';
  end if;


  if v_organization_id is distinct from
     public.current_organization_id()
  then
    raise exception 'Session note does not belong to your organization';
  end if;


  if v_status <> 'returned' then
    raise exception
      'Only returned session notes can be resubmitted';
  end if;


  if not public.is_assigned_session_provider(
    v_session_id
  ) then
    raise exception
      'You are not the assigned provider for this session';
  end if;


  update public.session_notes
  set
    status = 'submitted',
    submitted_at = now(),
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
  where id = p_note_id
    and organization_id =
        public.current_organization_id()
    and status = 'returned';


  if not found then
    raise exception
      'Session note could not be resubmitted';
  end if;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.undo_latest_behavior_event(requested_session_id uuid, requested_client_behavior_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event_to_remove uuid;
begin
  PERFORM rejoyce_security.require_unlocked();
  if not public.is_assigned_to_session(
    requested_session_id
  ) then
    raise exception
      'You are not assigned to this session';
  end if;

  if not exists (
    select 1
    from public.sessions as s
    where s.id = requested_session_id
      and s.status in (
        'in_progress',
        'paused'
      )
  ) then
    raise exception
      'Behavior events can only be changed during an active session';
  end if;

  select be.id
  into event_to_remove
  from public.behavior_events as be
  where be.session_id = requested_session_id
    and be.client_behavior_id =
      requested_client_behavior_id
    and be.provider_id = auth.uid()
    and be.organization_id =
      public.current_organization_id()
  order by be.occurred_at desc
  limit 1;

  if event_to_remove is null then
    raise exception
      'No behavior event is available to undo';
  end if;

  delete from public.behavior_events
  where id = event_to_remove;

  return event_to_remove;
end;
$function$
;
NOTIFY pgrst, 'reload schema';

