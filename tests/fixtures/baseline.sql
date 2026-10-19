SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "rejoyce_security";


ALTER SCHEMA "rejoyce_security" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."session_note_remarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "note_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_name" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "operation_id" "uuid" NOT NULL,
    CONSTRAINT "session_note_remarks_body_check" CHECK ((("length"(TRIM(BOTH FROM "body")) >= 1) AND ("length"(TRIM(BOTH FROM "body")) <= 20000)))
);


ALTER TABLE "public"."session_note_remarks" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") RETURNS "public"."session_note_remarks"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 SELECT rejoyce_security.append_session_note_remark(p_session_id,p_body,p_operation_id);
$$;


ALTER FUNCTION "public"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_session_note"("p_note_id" "uuid", "p_review_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."approve_session_note"("p_note_id" "uuid", "p_review_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_client"("requested_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."can_access_client"("requested_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_reports"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    public.is_organization_owner()
    or public.can_view_reports()) ELSE false END;
$$;


ALTER FUNCTION "public"."can_access_reports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_assign_org_role"("requested_role" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."can_assign_org_role"("requested_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_billing"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_billing')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_billing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_clients"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_clients')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_clients"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_org_user"("requested_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN EXISTS (
    SELECT 1 FROM public.users AS target
    WHERE target.id = requested_user_id
      AND target.organization_id = public.current_organization_id()
      AND public.can_manage_users()
      AND target.role <> 'owner'
      AND target.id <> auth.uid()
      AND (target.role <> 'admin' OR public.current_user_role() IN ('owner', 'admin'))
  ) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_org_user"("requested_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_requested_user"("requested_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.can_manage_org_user(
    requested_user_id
  )) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_requested_user"("requested_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_sessions"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_sessions')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_users"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('manage_users')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_manage_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_review_session_data"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."can_review_session_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_review_sessions"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('review_sessions')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_review_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_reports"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select public.has_org_permission('view_reports')) ELSE false END;
$$;


ALTER FUNCTION "public"."can_view_reports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_client_with_locations"("p_first_name" "text", "p_last_name" "text", "p_preferred_name" "text", "p_assigned_provider_id" "uuid", "p_location_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."create_client_with_locations"("p_first_name" "text", "p_last_name" "text", "p_preferred_name" "text", "p_assigned_provider_id" "uuid", "p_location_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_prepared_session"("requested_client_id" "uuid", "requested_provider_id" "uuid", "requested_scheduled_start" timestamp with time zone, "requested_scheduled_end" timestamp with time zone, "requested_session_type" "text" DEFAULT 'direct_therapy'::"text", "requested_location" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."create_prepared_session"("requested_client_id" "uuid", "requested_provider_id" "uuid", "requested_scheduled_start" timestamp with time zone, "requested_scheduled_end" timestamp with time zone, "requested_session_type" "text", "requested_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_self_service_organization"("p_user_id" "uuid", "p_session_id" "uuid", "p_name" "text", "p_full_name" "text", "p_branch_name" "text", "p_organization_type" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."create_self_service_organization"("p_user_id" "uuid", "p_session_id" "uuid", "p_name" "text", "p_full_name" "text", "p_branch_name" "text", "p_organization_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select u.organization_id
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1) ELSE NULL::uuid END;
$$;


ALTER FUNCTION "public"."current_organization_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select u.role
  from public.users as u
  where u.id = auth.uid()
    and coalesce(u.status, 'active') = 'active'
  limit 1) ELSE NULL::text END;
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."device_policy_enabled"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ SELECT enforced FROM rejoyce_security.session_policy WHERE singleton; $$;


ALTER FUNCTION "public"."device_policy_enabled"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "provider_id" "uuid",
    "supervisor_id" "uuid",
    "session_type" "text" DEFAULT 'direct_therapy'::"text" NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "attendance_status" "text" DEFAULT 'unconfirmed'::"text" NOT NULL,
    "scheduled_start" timestamp with time zone,
    "scheduled_end" timestamp with time zone,
    "started_at" timestamp with time zone,
    "paused_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "total_paused_seconds" integer DEFAULT 0 NOT NULL,
    "location" "text",
    "was_supervised" boolean DEFAULT false NOT NULL,
    "internal_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prepared_by" "uuid",
    "prepared_at" timestamp with time zone,
    CONSTRAINT "sessions_attendance_status_check" CHECK (("attendance_status" = ANY (ARRAY['unconfirmed'::"text", 'present'::"text", 'absent'::"text", 'late'::"text", 'canceled'::"text"]))),
    CONSTRAINT "sessions_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'confirmed'::"text", 'in_progress'::"text", 'paused'::"text", 'completed'::"text", 'canceled'::"text", 'client_absent'::"text", 'provider_absent'::"text", 'no_show'::"text"]))),
    CONSTRAINT "sessions_total_paused_seconds_check" CHECK (("total_paused_seconds" >= 0))
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finish_assigned_session"("requested_session_id" "uuid") RETURNS "public"."sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
  if not public.is_assigned_to_session(requested_session_id) then
    raise exception 'You are not assigned to this session';
  end if;

  SELECT * INTO updated_session FROM public.sessions WHERE id=requested_session_id AND status='completed';
  IF FOUND THEN RETURN updated_session; END IF;
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
$$;


ALTER FUNCTION "public"."finish_assigned_session"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_tasks"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  template record;
  child_record record;
begin
  for template in
    select 
      id,
      daycare_id,
      title,
      type,
      classroom_id
    from task_templates
    where active = true
  loop

    -- CLASSROOM TASKS
    if template.type = 'classroom' then
      insert into tasks (
        daycare_id,
        title,
        classroom_id,
        template_id,
        due_at,
        generated_date
      )
      values (
        template.daycare_id,
        template.title,
        template.classroom_id,
        template.id,
        now(),
        current_date
      )
      on conflict do nothing;
    end if;

    -- CHILD TASKS 🔥
    if template.type = 'child' then
      for child_record in
        select id from children
        where daycare_id = template.daycare_id
      loop

        insert into tasks (
          daycare_id,
          title,
          child_id,
          template_id,
          due_at,
          generated_date
        )
        values (
          template.daycare_id,
          template.title,
          child_record.id,
          template.id,
          now(),
          current_date
        )
        on conflict do nothing;

      end loop;
    end if;

  end loop;
end;
$$;


ALTER FUNCTION "public"."generate_tasks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_auth_user_email_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.users
  set
    email = new.email
  where id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_auth_user_email_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.users (
    id,
    email,
    full_name,
    role,
    status
  )
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    'staff',
    'active'
  )
  on conflict (id)
  do update set
    email = excluded.email,
    full_name = coalesce(
      public.users.full_name,
      excluded.full_name
    );

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_org_permission"("requested_permission" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."has_org_permission"("requested_permission" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assigned_session_provider"("requested_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.sessions as s
    where s.id = requested_session_id
      and s.provider_id = auth.uid()
      and s.organization_id =
        public.current_organization_id()
  )) ELSE false END;
$$;


ALTER FUNCTION "public"."is_assigned_session_provider"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assigned_to_client"("requested_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."is_assigned_to_client"("requested_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assigned_to_session"("requested_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."is_assigned_to_session"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_frontline_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."is_frontline_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_organization_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    public.is_organization_owner()
    or public.can_manage_users()
    or public.can_manage_clients()
    or public.can_manage_sessions()
    or public.can_review_sessions()
    or public.can_view_reports()
    or public.can_manage_billing()) ELSE false END;
$$;


ALTER FUNCTION "public"."is_organization_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_organization_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    where u.id = auth.uid()
      and u.role = 'owner'
      and coalesce(u.status, 'active') = 'active'
      and u.organization_id is not null
  )) ELSE false END;
$$;


ALTER FUNCTION "public"."is_organization_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_same_organization"("requested_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select
    requested_organization_id is not null
    and requested_organization_id =
      public.current_organization_id()) ELSE false END;
$$;


ALTER FUNCTION "public"."is_same_organization"("requested_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_org_owner"("requested_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE WHEN rejoyce_security.session_is_unlocked() THEN (select exists (
    select 1
    from public.users as u
    where u.id = requested_user_id
      and u.organization_id =
        public.current_organization_id()
      and u.role = 'owner'
  )) ELSE false END;
$$;


ALTER FUNCTION "public"."is_user_org_owner"("requested_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_session_note"("p_note_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."lock_session_note"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manage_device_session"("p_user_id" "uuid", "p_session_id" "uuid", "p_action" "text", "p_proof_hash" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."manage_device_session"("p_user_id" "uuid", "p_session_id" "uuid", "p_action" "text", "p_proof_hash" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "reviewed_by" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_present" boolean,
    "provider_present" boolean,
    "supervisor_present" boolean,
    "structured_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "therapist_addendum" "text",
    "generated_note" "text",
    "final_note" "text",
    "generated_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_notes" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "locked_from_status" "text",
    "locked_at" timestamp with time zone,
    CONSTRAINT "session_notes_locked_from_status_check" CHECK (("locked_from_status" = ANY (ARRAY['submitted'::"text", 'approved'::"text"]))),
    CONSTRAINT "session_notes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'returned'::"text", 'approved'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."session_notes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text" DEFAULT NULL::"text", "p_addendum" "text" DEFAULT NULL::"text", "p_feedback" "text" DEFAULT NULL::"text") RETURNS "public"."session_notes"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 SELECT rejoyce_security.mutate_session_note(p_session_id,p_action,p_version,p_operation_id,p_final_note,p_addendum,p_feedback);
$$;


ALTER FUNCTION "public"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."organization_write_access"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 SELECT coalesce((SELECT organization_id IS NOT NULL AND rejoyce_security.organization_can_write(organization_id)
 FROM public.users WHERE id=p_user_id AND status='active'),false);
$$;


ALTER FUNCTION "public"."organization_write_access"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pause_assigned_session"("requested_session_id" "uuid") RETURNS "public"."sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
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
$$;


ALTER FUNCTION "public"."pause_assigned_session"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_session_targets"("requested_session_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  IF selected_session.status NOT IN ('scheduled','confirmed') OR selected_session.started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Target preparation is closed after the session starts';
  END IF;
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
$$;


ALTER FUNCTION "public"."prepare_session_targets"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."behavior_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "client_behavior_id" "uuid",
    "provider_id" "uuid",
    "behavior_name" "text" NOT NULL,
    "event_type" "text" DEFAULT 'frequency'::"text" NOT NULL,
    "count" integer DEFAULT 1 NOT NULL,
    "duration_seconds" integer,
    "intensity_level" integer,
    "notes" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    CONSTRAINT "behavior_events_count_check" CHECK (("count" >= 0)),
    CONSTRAINT "behavior_events_duration_seconds_check" CHECK ((("duration_seconds" IS NULL) OR ("duration_seconds" >= 0))),
    CONSTRAINT "behavior_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['frequency'::"text", 'duration'::"text", 'interval'::"text", 'intensity'::"text"]))),
    CONSTRAINT "behavior_events_intensity_level_check" CHECK ((("intensity_level" IS NULL) OR (("intensity_level" >= 1) AND ("intensity_level" <= 5))))
);


ALTER TABLE "public"."behavior_events" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid", "requested_duration_seconds" integer DEFAULT NULL::integer, "requested_intensity_level" integer DEFAULT NULL::integer, "requested_notes" "text" DEFAULT NULL::"text") RETURNS "public"."behavior_events"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_session public.sessions%rowtype;
  selected_behavior public.client_behaviors%rowtype;
  inserted_event public.behavior_events%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
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
$$;


ALTER FUNCTION "public"."record_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid", "requested_duration_seconds" integer, "requested_intensity_level" integer, "requested_notes" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."target_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_target_id" "uuid" NOT NULL,
    "provider_id" "uuid",
    "result" "text" NOT NULL,
    "prompt_level" "text",
    "trial_number" integer DEFAULT 1 NOT NULL,
    "response_value" numeric,
    "duration_seconds" integer,
    "notes" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "target_responses_duration_seconds_check" CHECK ((("duration_seconds" IS NULL) OR ("duration_seconds" >= 0))),
    CONSTRAINT "target_responses_result_check" CHECK (("result" = ANY (ARRAY['independent'::"text", 'prompted'::"text", 'retry'::"text", 'correct'::"text", 'incorrect'::"text", 'skipped'::"text", 'not_applicable'::"text"]))),
    CONSTRAINT "target_responses_trial_number_check" CHECK (("trial_number" > 0))
);


ALTER TABLE "public"."target_responses" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_target_response"("requested_session_target_id" "uuid", "requested_result" "text", "requested_prompt_level" "text" DEFAULT NULL::"text", "requested_notes" "text" DEFAULT NULL::"text") RETURNS "public"."target_responses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_target public.session_targets%rowtype;
  next_trial_number integer;
  inserted_response public.target_responses%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=(select session_id from public.session_targets where id=requested_session_target_id) AND organization_id=public.current_organization_id() FOR UPDATE;
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
$$;


ALTER FUNCTION "public"."record_target_response"("requested_session_target_id" "uuid", "requested_result" "text", "requested_prompt_level" "text", "requested_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_pin_login_attempt"("p_account_key" "text") RETURNS TABLE("allowed" boolean, "retry_after" integer, "attempt_id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $_$
DECLARE
  checked_at timestamptz;
  short_count integer;
  daily_count integer;
  short_first timestamptz;
  daily_first timestamptz;
  wait_seconds integer := 0;
  reserved_id uuid;
BEGIN
  IF p_account_key IS NULL OR p_account_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid account key' USING ERRCODE = '22023';
  END IF;
  -- Serialize admission, not the expensive bcrypt comparison. Pending attempts
  -- count as failures until success removes that exact reservation.
  PERFORM pg_advisory_xact_lock(hashtextextended('pin-login:' || p_account_key, 0));
  checked_at := clock_timestamp();
  SELECT count(*) FILTER (WHERE created_at > checked_at - interval '15 minutes'),
         count(*),
         min(created_at) FILTER (WHERE created_at > checked_at - interval '15 minutes'),
         min(created_at)
    INTO short_count, daily_count, short_first, daily_first
    FROM public.pin_login_attempts
    WHERE account_key = p_account_key AND created_at > checked_at - interval '24 hours';
  IF short_count >= 5 THEN
    wait_seconds := greatest(1, ceil(extract(epoch FROM short_first + interval '15 minutes' - checked_at))::integer);
  END IF;
  IF daily_count >= 20 THEN
    wait_seconds := greatest(wait_seconds, 1, ceil(extract(epoch FROM daily_first + interval '24 hours' - checked_at))::integer);
  END IF;
  IF wait_seconds > 0 THEN
    RETURN QUERY SELECT false, wait_seconds, NULL::uuid;
    RETURN;
  END IF;
  -- Bounded opportunistic cleanup; active attempts are never deleted here.
  DELETE FROM public.pin_login_attempts WHERE id IN (
    SELECT id FROM public.pin_login_attempts
    WHERE created_at <= checked_at - interval '24 hours'
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO public.pin_login_attempts(account_key, created_at)
    VALUES (p_account_key, checked_at) RETURNING id INTO reserved_id;
  RETURN QUERY SELECT true, 0, reserved_id;
END
$_$;


ALTER FUNCTION "public"."reserve_pin_login_attempt"("p_account_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resume_assigned_session"("requested_session_id" "uuid") RETURNS "public"."sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
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
$$;


ALTER FUNCTION "public"."resume_assigned_session"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."return_session_note_for_correction"("p_note_id" "uuid", "p_review_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."return_session_note_for_correction"("p_note_id" "uuid", "p_review_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_assigned_session_note_draft"("requested_session_id" "uuid", "requested_therapist_addendum" "text" DEFAULT NULL::"text", "requested_final_note" "text" DEFAULT NULL::"text") RETURNS "public"."session_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."save_assigned_session_note_draft"("requested_session_id" "uuid", "requested_therapist_addendum" "text", "requested_final_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_client_locations"("p_client_id" "uuid", "p_location_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."set_client_locations"("p_client_id" "uuid", "p_location_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_assigned_session"("requested_session_id" "uuid") RETURNS "public"."sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated_session public.sessions%rowtype;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
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
      'confirmed'
    )
  returning *
  into updated_session;

  if not found then
    raise exception
      'Session cannot be started from its current status';
  end if;

  return updated_session;
end;
$$;


ALTER FUNCTION "public"."start_assigned_session"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_assigned_session_note"("requested_session_id" "uuid") RETURNS "public"."session_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."submit_assigned_session_note"("requested_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_session_note_for_review"("p_note_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."submit_session_note_for_review"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."subscription_access"("p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ SELECT rejoyce_security.subscription_access(p_session_id); $$;


ALTER FUNCTION "public"."subscription_access"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
 SELECT rejoyce_security.swap_session_targets(p_session_id,p_first,p_second,p_first_order,p_second_order);
$$;


ALTER FUNCTION "public"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."undo_latest_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  event_to_remove uuid;
begin
  PERFORM rejoyce_security.require_unlocked();
  PERFORM 1 FROM public.sessions WHERE id=requested_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
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
$$;


ALTER FUNCTION "public"."undo_latest_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") RETURNS "public"."session_note_remarks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE actor public.users%rowtype; n public.session_notes%rowtype; r public.session_note_remarks%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT * INTO actor FROM public.users WHERE id=auth.uid() AND status='active' AND role IN ('owner','admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner or administrator access required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL OR nullif(trim(p_body),'') IS NULL OR length(p_body)>20000 THEN RAISE EXCEPTION 'A remark of 1–20000 characters and an operation ID are required'; END IF;
 PERFORM 1 FROM public.sessions WHERE id=p_session_id AND organization_id=actor.organization_id FOR UPDATE;
 SELECT * INTO n FROM public.session_notes WHERE session_id=p_session_id AND organization_id=actor.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Note unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.session_note_remarks WHERE operation_id=p_operation_id;
 IF FOUND THEN
   IF r.note_id IS DISTINCT FROM n.id OR r.author_id IS DISTINCT FROM actor.id OR r.body IS DISTINCT FROM trim(p_body) THEN RAISE EXCEPTION 'Operation ID already used'; END IF;
   RETURN r;
 END IF;
 INSERT INTO public.session_note_remarks(organization_id,session_id,note_id,author_id,author_name,body,operation_id)
 VALUES(n.organization_id,n.session_id,n.id,actor.id,coalesce(actor.full_name,'Administrator'),trim(p_body),p_operation_id) RETURNING * INTO r;
 RETURN r;
END;
$$;


ALTER FUNCTION "rejoyce_security"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."derive_session_client"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.client_id IS NULL THEN
    SELECT s.client_id INTO NEW.client_id FROM public.sessions s WHERE s.id=NEW.session_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
      SELECT s.client_id INTO NEW.client_id FROM public.sessions s WHERE s.id=NEW.session_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."derive_session_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."derive_task_organization"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT t.organization_id INTO NEW.organization_id FROM public.tasks t WHERE t.id=NEW.task_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."derive_task_organization"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."guard_billing_permission"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  changes_billing boolean;
BEGIN
  -- Trusted server/database maintenance retains its existing authority.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    changes_billing := coalesce(NEW.can_manage_billing, false);
  ELSE
    changes_billing :=
      coalesce(NEW.can_manage_billing, false) IS DISTINCT FROM coalesce(OLD.can_manage_billing, false)
      OR (
        (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
        AND (coalesce(NEW.can_manage_billing, false) OR coalesce(OLD.can_manage_billing, false))
      );
  END IF;

  IF changes_billing AND (
    auth.uid() IS NULL
    OR NOT coalesce(public.current_user_role() IN ('owner', 'admin'), false)
  ) THEN
    RAISE EXCEPTION 'Only owners and administrators can change billing permissions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."guard_billing_permission"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."guard_permission_delegation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  allowed boolean;
  changes_delegation boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  PERFORM rejoyce_security.require_unlocked();

  -- Existing RLS still requires Manage users for non-owner administrators.
  IF coalesce(public.current_user_role() IN ('owner', 'admin'), false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    changes_delegation := NEW.can_delegate_permissions;
  ELSE
    changes_delegation :=
      NEW.can_delegate_permissions IS DISTINCT FROM OLD.can_delegate_permissions
      OR (
        (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
        AND (NEW.can_delegate_permissions OR OLD.can_delegate_permissions)
      );
  END IF;

  IF changes_delegation THEN
    RAISE EXCEPTION 'Only owners and administrators can change permission delegation'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(p.can_manage_users AND p.can_delegate_permissions, false)
  INTO allowed
  FROM public.user_permissions AS p
  WHERE p.user_id = auth.uid()
    AND p.organization_id = public.current_organization_id();

  IF NOT coalesce(allowed, false) THEN
    RAISE EXCEPTION 'An owner or administrator must allow you to delegate permissions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."guard_permission_delegation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."guard_service_session"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
 IF current_user IN ('authenticated','anon') THEN
   IF TG_OP='INSERT' THEN
     IF NEW.status NOT IN ('scheduled','confirmed') OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.paused_at IS NOT NULL OR NEW.total_paused_seconds<>0 THEN
       RAISE EXCEPTION 'Create a scheduled session before starting service';
     END IF;
   ELSE
     IF OLD.status IN ('completed','canceled','client_absent','provider_absent','no_show') THEN RAISE EXCEPTION 'Historical sessions are read-only'; END IF;
     IF NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.paused_at IS DISTINCT FROM OLD.paused_at OR NEW.total_paused_seconds IS DISTINCT FROM OLD.total_paused_seconds THEN RAISE EXCEPTION 'Use the session controls to update service timing'; END IF;
     IF OLD.started_at IS NOT NULL AND
       (NEW.provider_id IS DISTINCT FROM OLD.provider_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id OR NEW.session_type IS DISTINCT FROM OLD.session_type OR NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end OR NEW.status IS DISTINCT FROM OLD.status) THEN RAISE EXCEPTION 'Assignment and schedule are locked after service starts'; END IF;
     IF OLD.started_at IS NULL AND NEW.status NOT IN ('scheduled','confirmed','canceled','client_absent','provider_absent','no_show') THEN RAISE EXCEPTION 'Use the provider session controls to start or finish service'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."guard_service_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."guard_session_target"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE s public.sessions%rowtype;
BEGIN
 IF current_user IN ('authenticated','anon') THEN
   IF TG_OP='UPDATE' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN RAISE EXCEPTION 'Targets cannot move between sessions'; END IF;
   SELECT * INTO s FROM public.sessions WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.session_id ELSE NEW.session_id END FOR UPDATE;
   IF NOT FOUND OR s.status NOT IN ('scheduled','confirmed') OR s.started_at IS NOT NULL THEN RAISE EXCEPTION 'Target preparation is closed after the session starts'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."guard_session_target"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."guard_subscription_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "rejoyce_security"."guard_subscription_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."is_note_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 SELECT rejoyce_security.session_is_unlocked() AND EXISTS (
   SELECT 1 FROM public.users WHERE id=auth.uid() AND status='active' AND role IN ('owner','admin')
 );
$$;


ALTER FUNCTION "rejoyce_security"."is_note_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") RETURNS "public"."session_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
 s public.sessions%rowtype; n public.session_notes%rowtype; prior public.session_note_history%rowtype;
 actor public.users%rowtype; payload jsonb; stamp timestamptz := clock_timestamp();
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 SELECT * INTO actor FROM public.users WHERE id=auth.uid() AND status='active';
 IF NOT FOUND OR p_operation_id IS NULL OR p_action IS NULL THEN RAISE EXCEPTION 'Active account and operation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.sessions WHERE id=p_session_id AND organization_id=actor.organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501'; END IF;
 IF p_action IN ('save','submit') THEN
   IF NOT public.is_frontline_staff() OR s.provider_id IS DISTINCT FROM actor.id THEN RAISE EXCEPTION 'Only the assigned provider may write this note' USING ERRCODE='42501'; END IF;
 ELSIF p_action IN ('revert_approval','unlock') THEN
   IF actor.role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Owner or administrator access required' USING ERRCODE='42501'; END IF;
 ELSIF p_action IN ('return','approve','lock') THEN
   IF NOT public.can_review_sessions() THEN RAISE EXCEPTION 'Review permission required' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unknown note action';
 END IF;
 payload := jsonb_build_object('action',p_action,'version',p_version,'final_note',p_final_note,'addendum',p_addendum,'feedback',p_feedback);
 SELECT * INTO prior FROM public.session_note_history WHERE operation_id=p_operation_id;
 IF FOUND THEN
   IF prior.session_id IS DISTINCT FROM s.id OR prior.actor_id IS DISTINCT FROM actor.id OR prior.request_payload IS DISTINCT FROM payload THEN
     RAISE EXCEPTION 'Operation ID already used for another request';
   END IF;
   SELECT * INTO n FROM public.session_notes WHERE id=prior.note_id;
   RETURN n;
 END IF;
 SELECT * INTO n FROM public.session_notes WHERE session_id=s.id FOR UPDATE;
 IF coalesce(n.version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'This note changed. Reload the latest version before trying again.' USING ERRCODE='40001'; END IF;
 IF p_action IN ('save','submit') THEN
   IF s.status NOT IN ('in_progress','paused','completed') THEN RAISE EXCEPTION 'Notes are available after the session starts'; END IF;
   IF n.id IS NOT NULL AND (n.author_id IS DISTINCT FROM actor.id OR n.status NOT IN ('draft','returned')) THEN RAISE EXCEPTION 'This note is read-only'; END IF;
   IF p_action='submit' AND s.status<>'completed' THEN RAISE EXCEPTION 'Complete the session before submitting its note'; END IF;
   IF p_action='submit' AND nullif(trim(p_final_note),'') IS NULL THEN RAISE EXCEPTION 'A completed note is required for submission'; END IF;
   IF length(coalesce(p_final_note,''))>100000 OR length(coalesce(p_addendum,''))>20000 THEN RAISE EXCEPTION 'Note text is too long'; END IF;
   IF n.id IS NULL THEN
     INSERT INTO public.session_notes(organization_id,session_id,author_id) VALUES(s.organization_id,s.id,actor.id) RETURNING * INTO n;
   END IF;
   UPDATE public.session_notes SET
     final_note=nullif(trim(p_final_note),''), therapist_addendum=nullif(trim(p_addendum),''),
     client_present=s.attendance_status='present',provider_present=s.started_at IS NOT NULL,supervisor_present=s.was_supervised,
     structured_summary=jsonb_build_object('session',to_jsonb(s),
       'targets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sort_order,id),'[]') FROM public.session_targets t WHERE session_id=s.id),
       'responses',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY recorded_at,id),'[]') FROM public.target_responses r WHERE session_id=s.id),
       'behaviors',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY occurred_at,id),'[]') FROM public.behavior_events b WHERE session_id=s.id)),
     status=CASE WHEN p_action='submit' THEN 'submitted' ELSE n.status END,
     submitted_at=CASE WHEN p_action='submit' THEN stamp ELSE n.submitted_at END,
     reviewed_by=CASE WHEN p_action='submit' THEN NULL ELSE n.reviewed_by END,
     reviewed_at=CASE WHEN p_action='submit' THEN NULL ELSE n.reviewed_at END,
     review_notes=CASE WHEN p_action='submit' THEN NULL ELSE n.review_notes END,
     version=p_version+1, updated_at=stamp WHERE id=n.id RETURNING * INTO n;
 ELSE
   IF n.id IS NULL THEN RAISE EXCEPTION 'No note exists for this session'; END IF;
   IF p_action IN ('return','approve') AND n.status<>'submitted' THEN RAISE EXCEPTION 'Only submitted notes can be reviewed'; END IF;
   IF p_action='return' AND nullif(trim(p_feedback),'') IS NULL THEN RAISE EXCEPTION 'Feedback is required to return a note'; END IF;
   IF length(coalesce(p_feedback,''))>20000 THEN RAISE EXCEPTION 'Feedback is too long'; END IF;
   IF p_action='revert_approval' AND n.status<>'approved' THEN RAISE EXCEPTION 'Only approved notes can have approval reverted'; END IF;
   IF p_action='lock' AND n.status NOT IN ('submitted','approved') THEN RAISE EXCEPTION 'Only submitted or approved notes can be locked'; END IF;
   IF p_action='unlock' AND (n.status<>'locked' OR n.locked_from_status IS NULL) THEN RAISE EXCEPTION 'This note cannot be unlocked'; END IF;
   UPDATE public.session_notes SET
     status=CASE p_action WHEN 'return' THEN 'returned' WHEN 'approve' THEN 'approved' WHEN 'revert_approval' THEN 'submitted' WHEN 'lock' THEN 'locked' WHEN 'unlock' THEN n.locked_from_status END,
     locked_from_status=CASE WHEN p_action='lock' THEN n.status WHEN p_action='unlock' THEN NULL ELSE n.locked_from_status END,
     locked_at=CASE WHEN p_action='lock' THEN stamp WHEN p_action='unlock' THEN NULL ELSE n.locked_at END,
     review_notes=CASE WHEN p_action IN ('approve','return') THEN nullif(trim(p_feedback),'') WHEN p_action='revert_approval' THEN NULL ELSE n.review_notes END,
     reviewed_by=CASE WHEN p_action IN ('approve','return') THEN actor.id WHEN p_action='revert_approval' THEN NULL ELSE n.reviewed_by END,
     reviewed_at=CASE WHEN p_action IN ('approve','return') THEN stamp WHEN p_action='revert_approval' THEN NULL ELSE n.reviewed_at END,
     version=n.version+1,updated_at=stamp WHERE id=n.id RETURNING * INTO n;
 END IF;
 INSERT INTO public.session_note_history(organization_id,session_id,note_id,actor_id,actor_name,action,operation_id,request_payload,snapshot)
 VALUES(s.organization_id,s.id,n.id,actor.id,coalesce(actor.full_name,'Team member'),p_action,p_operation_id,payload,to_jsonb(n));
 RETURN n;
END;
$$;


ALTER FUNCTION "rejoyce_security"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."organization_can_write"("p_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 SELECT NOT EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id)
 OR EXISTS(SELECT 1 FROM rejoyce_security.organization_subscriptions b WHERE b.organization_id=p_organization_id
   AND greatest(b.trial_ends_at,b.paid_through)>statement_timestamp());
$$;


ALTER FUNCTION "rejoyce_security"."organization_can_write"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND OLD.organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'An existing record cannot be moved between organizations'
      USING ERRCODE = '23514', CONSTRAINT = 'organization_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "rejoyce_security"."prevent_tenant_reassignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."require_unlocked"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT rejoyce_security.session_is_unlocked() THEN
    RAISE EXCEPTION 'PIN unlock or full sign-in required' USING ERRCODE='42501';
  END IF;
END
$$;


ALTER FUNCTION "rejoyce_security"."require_unlocked"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."session_is_unlocked"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "rejoyce_security"."session_is_unlocked"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."session_trial_exception"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 SELECT EXISTS(SELECT 1 FROM public.sessions s JOIN rejoyce_security.organization_subscriptions b ON b.organization_id=s.organization_id
 WHERE s.id=p_session_id AND s.started_at >= b.created_at AND s.started_at < b.trial_ends_at
 AND (s.completed_at IS NULL OR s.completed_at >= b.trial_ends_at)
 AND s.status IN ('in_progress','paused','completed'));
$$;


ALTER FUNCTION "rejoyce_security"."session_trial_exception"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."subscription_access"("p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "rejoyce_security"."subscription_access"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "rejoyce_security"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE s public.sessions%rowtype; a public.session_targets%rowtype; b public.session_targets%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 IF NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.sessions WHERE id=p_session_id AND organization_id=public.current_organization_id() FOR UPDATE;
 IF NOT FOUND OR s.status NOT IN ('scheduled','confirmed') OR s.started_at IS NOT NULL THEN RAISE EXCEPTION 'Session preparation is closed'; END IF;
 SELECT * INTO a FROM public.session_targets WHERE id=p_first AND session_id=s.id FOR UPDATE;
 SELECT * INTO b FROM public.session_targets WHERE id=p_second AND session_id=s.id FOR UPDATE;
 IF a.id IS NULL OR b.id IS NULL OR a.id=b.id OR a.sort_order IS DISTINCT FROM p_first_order OR b.sort_order IS DISTINCT FROM p_second_order THEN
   RAISE EXCEPTION 'Targets changed. Reload before reordering.' USING ERRCODE='40001';
 END IF;
 -- One transaction; failure rolls back both moves.
 UPDATE public.session_targets SET sort_order=CASE id WHEN a.id THEN b.sort_order ELSE a.sort_order END WHERE id IN(a.id,b.id);
END;
$$;


ALTER FUNCTION "rejoyce_security"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."children" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "name" "text" NOT NULL,
    "age" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."children" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classrooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "age_group" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."classrooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_behaviors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "measurement_type" "text" DEFAULT 'frequency'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_behaviors_measurement_type_check" CHECK (("measurement_type" = ANY (ARRAY['frequency'::"text", 'duration'::"text", 'interval'::"text", 'intensity'::"text"])))
);


ALTER TABLE "public"."client_behaviors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_locations" (
    "client_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "title" "text" NOT NULL,
    "instruction" "text",
    "category" "text",
    "target_type" "text" DEFAULT 'discrete_trial'::"text" NOT NULL,
    "response_mode" "text" DEFAULT 'independent_prompted_retry'::"text" NOT NULL,
    "mastery_criteria" "text",
    "materials" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_targets_response_mode_check" CHECK (("response_mode" = ANY (ARRAY['independent_prompted_retry'::"text", 'correct_incorrect'::"text", 'frequency'::"text", 'duration'::"text", 'custom'::"text"]))),
    CONSTRAINT "client_targets_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'mastered'::"text", 'discontinued'::"text"]))),
    CONSTRAINT "client_targets_target_type_check" CHECK (("target_type" = ANY (ARRAY['discrete_trial'::"text", 'frequency'::"text", 'duration'::"text", 'interval'::"text", 'task_analysis'::"text", 'natural_environment'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."client_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "assigned_provider_id" "uuid",
    "first_name" "text" NOT NULL,
    "last_name" "text",
    "preferred_name" "text",
    "date_of_birth" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clients_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'on_hold'::"text", 'discharged'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_tasks" (
    "organization_id" "uuid" NOT NULL
);


ALTER TABLE "public"."daily_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_sessions" (
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_auth_at" timestamp with time zone NOT NULL,
    "last_pin_at" timestamp with time zone NOT NULL,
    "unlocked_until" timestamp with time zone NOT NULL,
    "revoked" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."device_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_login_challenges" (
    "proof_hash" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "email_login_challenges_proof_hash_check" CHECK (("proof_hash" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."email_login_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generated_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid",
    "organization_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "child_id" "uuid",
    "title" "text" NOT NULL,
    "due_time" timestamp without time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."generated_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_terminology" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_singular" "text" DEFAULT 'Client'::"text" NOT NULL,
    "client_plural" "text" DEFAULT 'Clients'::"text" NOT NULL,
    "frontline_singular" "text" DEFAULT 'Team Member'::"text" NOT NULL,
    "frontline_plural" "text" DEFAULT 'Team Members'::"text" NOT NULL,
    "session_singular" "text" DEFAULT 'Session'::"text" NOT NULL,
    "session_plural" "text" DEFAULT 'Sessions'::"text" NOT NULL,
    "target_singular" "text" DEFAULT 'Target'::"text" NOT NULL,
    "target_plural" "text" DEFAULT 'Targets'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_terminology" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_type" "text" DEFAULT 'Childcare Center'::"text",
    "license_number" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "address" "text",
    "branding_logo_url" "text",
    "subscription_status" "text" DEFAULT 'active'::"text"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "organization_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "staff_size" "text",
    "message" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid"
);


ALTER TABLE "public"."owner_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pin_login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "pin_login_attempts_account_key_check" CHECK (("account_key" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."pin_login_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_note_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "note_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "actor_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "operation_id" "uuid" NOT NULL,
    "request_payload" "jsonb" NOT NULL,
    "snapshot" "jsonb" NOT NULL
);


ALTER TABLE "public"."session_note_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "client_target_id" "uuid",
    "title" "text" NOT NULL,
    "instruction" "text",
    "category" "text",
    "target_type" "text" DEFAULT 'discrete_trial'::"text" NOT NULL,
    "response_mode" "text" DEFAULT 'independent_prompted_retry'::"text" NOT NULL,
    "materials" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    CONSTRAINT "session_targets_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."session_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "default_duration_minutes" integer,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_types_default_duration_minutes_check" CHECK ((("default_duration_minutes" IS NULL) OR ("default_duration_minutes" > 0)))
);


ALTER TABLE "public"."session_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_admins" (
    "user_id" "uuid" NOT NULL,
    "access_level" "text" DEFAULT 'support'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "system_admins_access_level_check" CHECK (("access_level" = ANY (ARRAY['support'::"text", 'admin'::"text", 'super_admin'::"text"])))
);


ALTER TABLE "public"."system_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."target_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."target_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "completed_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "organization_id" "uuid" NOT NULL
);


ALTER TABLE "public"."task_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "child_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "task_type" "text",
    "recurrence" "text",
    "interval_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" NOT NULL,
    "classroom_id" "uuid",
    "frequency" "text" NOT NULL,
    "time_of_day" time without time zone,
    "active" boolean DEFAULT true,
    CONSTRAINT "task_templates_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'hourly'::"text", 'custom'::"text"]))),
    CONSTRAINT "task_templates_recurrence_check" CHECK (("recurrence" = ANY (ARRAY['daily'::"text", 'hourly'::"text", 'custom'::"text"]))),
    CONSTRAINT "task_templates_task_type_check" CHECK (("task_type" = ANY (ARRAY['child'::"text", 'classroom'::"text"]))),
    CONSTRAINT "task_templates_type_check" CHECK (("type" = ANY (ARRAY['classroom'::"text", 'child'::"text"])))
);


ALTER TABLE "public"."task_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "child_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "task_type" "text",
    "due_time" timestamp without time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "classroom_id" "uuid",
    "template_id" "uuid",
    "due_at" timestamp with time zone,
    "completed" boolean DEFAULT false,
    "generated_date" "date",
    CONSTRAINT "tasks_task_type_check" CHECK (("task_type" = ANY (ARRAY['child'::"text", 'classroom'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "can_manage_billing" boolean DEFAULT false NOT NULL,
    "can_manage_access" boolean DEFAULT false NOT NULL,
    "can_manage_team" boolean DEFAULT false NOT NULL,
    "can_manage_operations" boolean DEFAULT false NOT NULL,
    "can_manage_clients" boolean DEFAULT false NOT NULL,
    "can_manage_sessions" boolean DEFAULT false NOT NULL,
    "can_review_sessions" boolean DEFAULT false NOT NULL,
    "can_view_reports" boolean DEFAULT false NOT NULL,
    "can_manage_settings" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "can_manage_users" boolean DEFAULT false NOT NULL,
    "can_delegate_permissions" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."user_permissions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_permissions"."can_delegate_permissions" IS 'Owner/admin-controlled permission to edit nonbilling grants; also requires can_manage_users.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "full_name" "text",
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "username" "text",
    "pin_hash" "text",
    "is_active" boolean DEFAULT true,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "email" "text",
    "pin_reset_required" boolean DEFAULT false NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'director'::"text", 'therapist'::"text", 'teacher'::"text", 'educator'::"text", 'assistant'::"text", 'aide'::"text", 'caregiver'::"text", 'staff'::"text"]))),
    CONSTRAINT "users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'invited'::"text", 'disabled'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "rejoyce_security"."organization_subscriptions" (
    "organization_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "plan_version" "text" DEFAULT 'launch-2026-09'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "trial_ends_at" timestamp with time zone NOT NULL,
    "paid_through" timestamp with time zone,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "provider_seats" integer,
    "creation_payload" "jsonb" NOT NULL,
    CONSTRAINT "organization_subscriptions_check" CHECK (("trial_ends_at" > "created_at")),
    CONSTRAINT "organization_subscriptions_provider_seats_check" CHECK (("provider_seats" >= 1))
);


ALTER TABLE "rejoyce_security"."organization_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "rejoyce_security"."session_policy" (
    "singleton" boolean DEFAULT true NOT NULL,
    "enforced" boolean DEFAULT false NOT NULL,
    CONSTRAINT "session_policy_singleton_check" CHECK ("singleton")
);


ALTER TABLE "rejoyce_security"."session_policy" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."behavior_events"
    ADD CONSTRAINT "behavior_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."children"
    ADD CONSTRAINT "children_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."children"
    ADD CONSTRAINT "children_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."classrooms"
    ADD CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classrooms"
    ADD CONSTRAINT "classrooms_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."client_behaviors"
    ADD CONSTRAINT "client_behaviors_client_tenant_key" UNIQUE ("id", "client_id", "organization_id");



ALTER TABLE ONLY "public"."client_behaviors"
    ADD CONSTRAINT "client_behaviors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_locations"
    ADD CONSTRAINT "client_locations_pkey" PRIMARY KEY ("client_id", "location_id");



ALTER TABLE ONLY "public"."client_targets"
    ADD CONSTRAINT "client_targets_client_tenant_key" UNIQUE ("id", "client_id", "organization_id");



ALTER TABLE ONLY "public"."client_targets"
    ADD CONSTRAINT "client_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."generated_tasks"
    ADD CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "daycares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_sessions"
    ADD CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."email_login_challenges"
    ADD CONSTRAINT "email_login_challenges_pkey" PRIMARY KEY ("proof_hash");



ALTER TABLE ONLY "public"."organization_locations"
    ADD CONSTRAINT "organization_locations_name_unique" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."organization_locations"
    ADD CONSTRAINT "organization_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_locations"
    ADD CONSTRAINT "organization_locations_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."organization_terminology"
    ADD CONSTRAINT "organization_terminology_org_unique" UNIQUE ("organization_id");



ALTER TABLE ONLY "public"."organization_terminology"
    ADD CONSTRAINT "organization_terminology_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."owner_requests"
    ADD CONSTRAINT "owner_requests_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."owner_requests"
    ADD CONSTRAINT "owner_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pin_login_attempts"
    ADD CONSTRAINT "pin_login_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_note_history"
    ADD CONSTRAINT "session_note_history_operation_id_key" UNIQUE ("operation_id");



ALTER TABLE ONLY "public"."session_note_history"
    ADD CONSTRAINT "session_note_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_note_remarks"
    ADD CONSTRAINT "session_note_remarks_operation_id_key" UNIQUE ("operation_id");



ALTER TABLE ONLY "public"."session_note_remarks"
    ADD CONSTRAINT "session_note_remarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_session_unique" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_session_target_unique" UNIQUE ("session_id", "client_target_id");



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_session_tenant_key" UNIQUE ("id", "session_id", "organization_id");



ALTER TABLE ONLY "public"."session_types"
    ADD CONSTRAINT "session_types_org_code_unique" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."session_types"
    ADD CONSTRAINT "session_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_client_tenant_key" UNIQUE ("id", "client_id", "organization_id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."system_admins"
    ADD CONSTRAINT "system_admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."target_categories"
    ADD CONSTRAINT "target_categories_name_unique" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."target_categories"
    ADD CONSTRAINT "target_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."target_responses"
    ADD CONSTRAINT "target_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_completions"
    ADD CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_key" UNIQUE ("id", "organization_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_owner_id_key" UNIQUE ("owner_id");



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "rejoyce_security"."session_policy"
    ADD CONSTRAINT "session_policy_pkey" PRIMARY KEY ("singleton");



CREATE INDEX "behavior_events_client_behavior_id_fkey_tenant_idx" ON "public"."behavior_events" USING "btree" ("client_behavior_id", "client_id", "organization_id");



CREATE INDEX "behavior_events_provider_id_fkey_tenant_idx" ON "public"."behavior_events" USING "btree" ("provider_id", "organization_id");



CREATE INDEX "behavior_events_session_id_fkey_tenant_idx" ON "public"."behavior_events" USING "btree" ("session_id", "client_id", "organization_id");



CREATE INDEX "behavior_events_session_id_idx" ON "public"."behavior_events" USING "btree" ("session_id");



CREATE INDEX "children_teacher_id_fkey_tenant_idx" ON "public"."children" USING "btree" ("teacher_id", "organization_id");



CREATE INDEX "client_behaviors_client_id_fkey_tenant_idx" ON "public"."client_behaviors" USING "btree" ("client_id", "organization_id");



CREATE INDEX "client_behaviors_client_id_idx" ON "public"."client_behaviors" USING "btree" ("client_id");



CREATE INDEX "client_locations_client_tenant_idx" ON "public"."client_locations" USING "btree" ("client_id", "organization_id");



CREATE INDEX "client_locations_location_tenant_idx" ON "public"."client_locations" USING "btree" ("location_id", "organization_id");



CREATE INDEX "client_locations_organization_idx" ON "public"."client_locations" USING "btree" ("organization_id");



CREATE INDEX "client_targets_client_id_fkey_tenant_idx" ON "public"."client_targets" USING "btree" ("client_id", "organization_id");



CREATE INDEX "client_targets_client_id_idx" ON "public"."client_targets" USING "btree" ("client_id");



CREATE INDEX "client_targets_created_by_fkey_tenant_idx" ON "public"."client_targets" USING "btree" ("created_by", "organization_id");



CREATE INDEX "clients_assigned_provider_id_fkey_tenant_idx" ON "public"."clients" USING "btree" ("assigned_provider_id", "organization_id");



CREATE INDEX "clients_assigned_provider_id_idx" ON "public"."clients" USING "btree" ("assigned_provider_id");



CREATE INDEX "clients_organization_id_idx" ON "public"."clients" USING "btree" ("organization_id");



CREATE INDEX "daily_tasks_child_id_fkey_tenant_idx" ON "public"."generated_tasks" USING "btree" ("child_id", "organization_id");



CREATE INDEX "daily_tasks_teacher_id_fkey_tenant_idx" ON "public"."generated_tasks" USING "btree" ("teacher_id", "organization_id");



CREATE INDEX "daily_tasks_template_id_fkey_tenant_idx" ON "public"."generated_tasks" USING "btree" ("template_id", "organization_id");



CREATE INDEX "email_login_challenges_expiry" ON "public"."email_login_challenges" USING "btree" ("created_at");



CREATE INDEX "fk_tasks_classroom_tenant_idx" ON "public"."tasks" USING "btree" ("classroom_id", "organization_id");



CREATE INDEX "fk_tasks_template_tenant_idx" ON "public"."tasks" USING "btree" ("template_id", "organization_id");



CREATE INDEX "idx_behavior_events_occurred_at" ON "public"."behavior_events" USING "btree" ("occurred_at");



CREATE INDEX "idx_behavior_events_organization_id" ON "public"."behavior_events" USING "btree" ("organization_id");



CREATE INDEX "idx_behavior_events_session_id" ON "public"."behavior_events" USING "btree" ("session_id");



CREATE INDEX "idx_classrooms_daycare" ON "public"."classrooms" USING "btree" ("organization_id");



CREATE INDEX "idx_client_behaviors_client_id" ON "public"."client_behaviors" USING "btree" ("client_id");



CREATE INDEX "idx_client_behaviors_organization_id" ON "public"."client_behaviors" USING "btree" ("organization_id");



CREATE INDEX "idx_client_targets_client_id" ON "public"."client_targets" USING "btree" ("client_id");



CREATE INDEX "idx_client_targets_organization_id" ON "public"."client_targets" USING "btree" ("organization_id");



CREATE INDEX "idx_client_targets_status" ON "public"."client_targets" USING "btree" ("status");



CREATE INDEX "idx_clients_assigned_provider_id" ON "public"."clients" USING "btree" ("assigned_provider_id");



CREATE INDEX "idx_clients_organization_id" ON "public"."clients" USING "btree" ("organization_id");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_session_notes_author_id" ON "public"."session_notes" USING "btree" ("author_id");



CREATE INDEX "idx_session_notes_organization_id" ON "public"."session_notes" USING "btree" ("organization_id");



CREATE INDEX "idx_session_notes_status" ON "public"."session_notes" USING "btree" ("status");



CREATE INDEX "idx_session_targets_organization_id" ON "public"."session_targets" USING "btree" ("organization_id");



CREATE INDEX "idx_session_targets_session_id" ON "public"."session_targets" USING "btree" ("session_id");



CREATE INDEX "idx_session_targets_sort_order" ON "public"."session_targets" USING "btree" ("session_id", "sort_order");



CREATE INDEX "idx_session_targets_status" ON "public"."session_targets" USING "btree" ("status");



CREATE INDEX "idx_sessions_client_id" ON "public"."sessions" USING "btree" ("client_id");



CREATE INDEX "idx_sessions_organization_id" ON "public"."sessions" USING "btree" ("organization_id");



CREATE INDEX "idx_sessions_provider_id" ON "public"."sessions" USING "btree" ("provider_id");



CREATE INDEX "idx_sessions_scheduled_start" ON "public"."sessions" USING "btree" ("scheduled_start");



CREATE INDEX "idx_sessions_status" ON "public"."sessions" USING "btree" ("status");



CREATE INDEX "idx_target_responses_organization_id" ON "public"."target_responses" USING "btree" ("organization_id");



CREATE INDEX "idx_target_responses_recorded_at" ON "public"."target_responses" USING "btree" ("recorded_at");



CREATE INDEX "idx_target_responses_session_id" ON "public"."target_responses" USING "btree" ("session_id");



CREATE INDEX "idx_target_responses_session_target_id" ON "public"."target_responses" USING "btree" ("session_target_id");



CREATE INDEX "idx_task_templates_active" ON "public"."task_templates" USING "btree" ("active");



CREATE INDEX "idx_task_templates_daycare" ON "public"."task_templates" USING "btree" ("organization_id");



CREATE INDEX "idx_user_permissions_user_id" ON "public"."user_permissions" USING "btree" ("user_id");



CREATE INDEX "owner_requests_organization_id_idx" ON "public"."owner_requests" USING "btree" ("organization_id");



CREATE INDEX "pin_login_attempts_account_time" ON "public"."pin_login_attempts" USING "btree" ("account_key", "created_at");



CREATE INDEX "pin_login_attempts_expiry" ON "public"."pin_login_attempts" USING "btree" ("created_at");



CREATE INDEX "session_note_history_note" ON "public"."session_note_history" USING "btree" ("note_id");



CREATE INDEX "session_note_history_organization" ON "public"."session_note_history" USING "btree" ("organization_id");



CREATE INDEX "session_note_history_session_time" ON "public"."session_note_history" USING "btree" ("session_id", "occurred_at" DESC, "id");



CREATE INDEX "session_note_remarks_note" ON "public"."session_note_remarks" USING "btree" ("note_id");



CREATE INDEX "session_note_remarks_organization" ON "public"."session_note_remarks" USING "btree" ("organization_id");



CREATE INDEX "session_note_remarks_session_time" ON "public"."session_note_remarks" USING "btree" ("session_id", "created_at", "id");



CREATE INDEX "session_notes_author_id_fkey_tenant_idx" ON "public"."session_notes" USING "btree" ("author_id", "organization_id");



CREATE INDEX "session_notes_review_queue_idx" ON "public"."session_notes" USING "btree" ("organization_id", "status", "submitted_at" DESC);



CREATE INDEX "session_notes_reviewed_by_fkey_tenant_idx" ON "public"."session_notes" USING "btree" ("reviewed_by", "organization_id");



CREATE INDEX "session_notes_reviewed_by_idx" ON "public"."session_notes" USING "btree" ("reviewed_by");



CREATE INDEX "session_notes_session_id_fkey_tenant_idx" ON "public"."session_notes" USING "btree" ("session_id", "organization_id");



CREATE INDEX "session_notes_session_id_idx" ON "public"."session_notes" USING "btree" ("session_id");



CREATE INDEX "session_targets_client_target_id_fkey_tenant_idx" ON "public"."session_targets" USING "btree" ("client_target_id", "client_id", "organization_id");



CREATE INDEX "session_targets_session_id_fkey_tenant_idx" ON "public"."session_targets" USING "btree" ("session_id", "client_id", "organization_id");



CREATE INDEX "session_targets_session_id_idx" ON "public"."session_targets" USING "btree" ("session_id");



CREATE INDEX "sessions_client_id_fkey_tenant_idx" ON "public"."sessions" USING "btree" ("client_id", "organization_id");



CREATE INDEX "sessions_client_id_idx" ON "public"."sessions" USING "btree" ("client_id");



CREATE INDEX "sessions_organization_id_idx" ON "public"."sessions" USING "btree" ("organization_id");



CREATE INDEX "sessions_prepared_by_fkey_tenant_idx" ON "public"."sessions" USING "btree" ("prepared_by", "organization_id");



CREATE INDEX "sessions_provider_id_fkey_tenant_idx" ON "public"."sessions" USING "btree" ("provider_id", "organization_id");



CREATE INDEX "sessions_provider_id_idx" ON "public"."sessions" USING "btree" ("provider_id");



CREATE INDEX "sessions_supervisor_id_fkey_tenant_idx" ON "public"."sessions" USING "btree" ("supervisor_id", "organization_id");



CREATE INDEX "target_responses_provider_id_fkey_tenant_idx" ON "public"."target_responses" USING "btree" ("provider_id", "organization_id");



CREATE INDEX "target_responses_session_id_fkey_tenant_idx" ON "public"."target_responses" USING "btree" ("session_id", "organization_id");



CREATE INDEX "target_responses_session_id_idx" ON "public"."target_responses" USING "btree" ("session_id");



CREATE INDEX "target_responses_session_target_id_fkey_tenant_idx" ON "public"."target_responses" USING "btree" ("session_target_id", "session_id", "organization_id");



CREATE INDEX "task_completions_task_id_fkey_tenant_idx" ON "public"."task_completions" USING "btree" ("task_id", "organization_id");



CREATE INDEX "task_completions_teacher_id_fkey_tenant_idx" ON "public"."task_completions" USING "btree" ("teacher_id", "organization_id");



CREATE INDEX "task_templates_child_id_fkey_tenant_idx" ON "public"."task_templates" USING "btree" ("child_id", "organization_id");



CREATE INDEX "task_templates_classroom_id_fkey_tenant_idx" ON "public"."task_templates" USING "btree" ("classroom_id", "organization_id");



CREATE INDEX "task_templates_teacher_id_fkey_tenant_idx" ON "public"."task_templates" USING "btree" ("teacher_id", "organization_id");



CREATE INDEX "tasks_child_id_fkey_tenant_idx" ON "public"."tasks" USING "btree" ("child_id", "organization_id");



CREATE INDEX "tasks_teacher_id_fkey_tenant_idx" ON "public"."tasks" USING "btree" ("teacher_id", "organization_id");



CREATE UNIQUE INDEX "unique_task_per_day" ON "public"."tasks" USING "btree" ("template_id", "classroom_id", "child_id", "generated_date");



CREATE INDEX "user_permissions_organization_id_idx" ON "public"."user_permissions" USING "btree" ("organization_id");



CREATE INDEX "user_permissions_user_id_fkey_tenant_idx" ON "public"."user_permissions" USING "btree" ("user_id", "organization_id");



CREATE UNIQUE INDEX "users_email_unique_lower" ON "public"."users" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "users_organization_id_idx" ON "public"."users" USING "btree" ("organization_id");



CREATE OR REPLACE TRIGGER "derive_session_client" BEFORE INSERT OR UPDATE OF "session_id", "client_id" ON "public"."behavior_events" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."derive_session_client"();



CREATE OR REPLACE TRIGGER "derive_session_client" BEFORE INSERT OR UPDATE OF "session_id", "client_id" ON "public"."session_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."derive_session_client"();



CREATE OR REPLACE TRIGGER "derive_task_organization" BEFORE INSERT ON "public"."task_completions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."derive_task_organization"();



CREATE OR REPLACE TRIGGER "guard_billing_permission" AFTER INSERT OR UPDATE ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_billing_permission"();



CREATE OR REPLACE TRIGGER "guard_permission_delegation" AFTER INSERT OR UPDATE ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_permission_delegation"();



CREATE OR REPLACE TRIGGER "guard_service_session" BEFORE INSERT OR UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_service_session"();



CREATE OR REPLACE TRIGGER "guard_session_target" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_session_target"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."behavior_events" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."children" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."classrooms" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."client_behaviors" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."client_locations" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."client_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."daily_tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."generated_tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."organization_locations" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."organization_terminology" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."owner_requests" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."session_notes" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."session_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."session_types" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."target_categories" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."target_responses" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."task_completions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."task_templates" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "prevent_tenant_reassignment" BEFORE UPDATE OF "organization_id" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."prevent_tenant_reassignment"();



CREATE OR REPLACE TRIGGER "set_client_behaviors_updated_at" BEFORE UPDATE ON "public"."client_behaviors" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_client_targets_updated_at" BEFORE UPDATE ON "public"."client_targets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organization_locations_updated_at" BEFORE UPDATE ON "public"."organization_locations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organization_terminology_updated_at" BEFORE UPDATE ON "public"."organization_terminology" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_session_notes_updated_at" BEFORE UPDATE ON "public"."session_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_session_targets_updated_at" BEFORE UPDATE ON "public"."session_targets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_session_types_updated_at" BEFORE UPDATE ON "public"."session_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_sessions_updated_at" BEFORE UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_target_categories_updated_at" BEFORE UPDATE ON "public"."target_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_user_permissions_updated_at" BEFORE UPDATE ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."behavior_events" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."children" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."classrooms" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."client_behaviors" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."client_locations" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."client_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."daily_tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."generated_tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."organization_locations" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."organization_terminology" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."owner_requests" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_note_history" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_note_remarks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_notes" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_targets" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."session_types" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."target_categories" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."target_responses" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."task_completions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."task_templates" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



CREATE OR REPLACE TRIGGER "zz_subscription_write" BEFORE INSERT OR DELETE OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "rejoyce_security"."guard_subscription_write"();



ALTER TABLE ONLY "public"."behavior_events"
    ADD CONSTRAINT "behavior_events_client_behavior_id_fkey" FOREIGN KEY ("client_behavior_id", "client_id", "organization_id") REFERENCES "public"."client_behaviors"("id", "client_id", "organization_id") ON DELETE SET NULL ("client_behavior_id");



ALTER TABLE ONLY "public"."behavior_events"
    ADD CONSTRAINT "behavior_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."behavior_events"
    ADD CONSTRAINT "behavior_events_provider_id_fkey" FOREIGN KEY ("provider_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("provider_id");



ALTER TABLE ONLY "public"."behavior_events"
    ADD CONSTRAINT "behavior_events_session_id_fkey" FOREIGN KEY ("session_id", "client_id", "organization_id") REFERENCES "public"."sessions"("id", "client_id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."children"
    ADD CONSTRAINT "children_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."children"
    ADD CONSTRAINT "children_teacher_id_fkey" FOREIGN KEY ("teacher_id", "organization_id") REFERENCES "public"."users"("id", "organization_id");



ALTER TABLE ONLY "public"."classrooms"
    ADD CONSTRAINT "classrooms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_behaviors"
    ADD CONSTRAINT "client_behaviors_client_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "public"."clients"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_behaviors"
    ADD CONSTRAINT "client_behaviors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_locations"
    ADD CONSTRAINT "client_locations_client_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "public"."clients"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_locations"
    ADD CONSTRAINT "client_locations_location_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "public"."organization_locations"("id", "organization_id");



ALTER TABLE ONLY "public"."client_targets"
    ADD CONSTRAINT "client_targets_client_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "public"."clients"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_targets"
    ADD CONSTRAINT "client_targets_created_by_fkey" FOREIGN KEY ("created_by", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("created_by");



ALTER TABLE ONLY "public"."client_targets"
    ADD CONSTRAINT "client_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_assigned_provider_id_fkey" FOREIGN KEY ("assigned_provider_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("assigned_provider_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generated_tasks"
    ADD CONSTRAINT "daily_tasks_child_id_fkey" FOREIGN KEY ("child_id", "organization_id") REFERENCES "public"."children"("id", "organization_id");



ALTER TABLE ONLY "public"."generated_tasks"
    ADD CONSTRAINT "daily_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_tasks"
    ADD CONSTRAINT "daily_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_tasks"
    ADD CONSTRAINT "daily_tasks_organization_id_fkey1" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generated_tasks"
    ADD CONSTRAINT "daily_tasks_teacher_id_fkey" FOREIGN KEY ("teacher_id", "organization_id") REFERENCES "public"."users"("id", "organization_id");



ALTER TABLE ONLY "public"."generated_tasks"
    ADD CONSTRAINT "daily_tasks_template_id_fkey" FOREIGN KEY ("template_id", "organization_id") REFERENCES "public"."task_templates"("id", "organization_id");



ALTER TABLE ONLY "public"."device_sessions"
    ADD CONSTRAINT "device_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_sessions"
    ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_login_challenges"
    ADD CONSTRAINT "email_login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "fk_tasks_classroom" FOREIGN KEY ("classroom_id", "organization_id") REFERENCES "public"."classrooms"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "fk_tasks_template" FOREIGN KEY ("template_id", "organization_id") REFERENCES "public"."task_templates"("id", "organization_id") ON DELETE SET NULL ("template_id");



ALTER TABLE ONLY "public"."organization_locations"
    ADD CONSTRAINT "organization_locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_terminology"
    ADD CONSTRAINT "organization_terminology_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."owner_requests"
    ADD CONSTRAINT "owner_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."session_note_history"
    ADD CONSTRAINT "session_note_history_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."session_notes"("id");



ALTER TABLE ONLY "public"."session_note_history"
    ADD CONSTRAINT "session_note_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."session_note_history"
    ADD CONSTRAINT "session_note_history_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "public"."sessions"("id", "organization_id");



ALTER TABLE ONLY "public"."session_note_remarks"
    ADD CONSTRAINT "session_note_remarks_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."session_notes"("id");



ALTER TABLE ONLY "public"."session_note_remarks"
    ADD CONSTRAINT "session_note_remarks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."session_note_remarks"
    ADD CONSTRAINT "session_note_remarks_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "public"."sessions"("id", "organization_id");



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_author_id_fkey" FOREIGN KEY ("author_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("author_id");



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_reviewed_by_fkey" FOREIGN KEY ("reviewed_by", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("reviewed_by");



ALTER TABLE ONLY "public"."session_notes"
    ADD CONSTRAINT "session_notes_session_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "public"."sessions"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_client_target_id_fkey" FOREIGN KEY ("client_target_id", "client_id", "organization_id") REFERENCES "public"."client_targets"("id", "client_id", "organization_id") ON DELETE SET NULL ("client_target_id");



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_targets"
    ADD CONSTRAINT "session_targets_session_id_fkey" FOREIGN KEY ("session_id", "client_id", "organization_id") REFERENCES "public"."sessions"("id", "client_id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_types"
    ADD CONSTRAINT "session_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_client_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "public"."clients"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_prepared_by_fkey" FOREIGN KEY ("prepared_by", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("prepared_by");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_provider_id_fkey" FOREIGN KEY ("provider_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("provider_id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_supervisor_id_fkey" FOREIGN KEY ("supervisor_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("supervisor_id");



ALTER TABLE ONLY "public"."system_admins"
    ADD CONSTRAINT "system_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."target_categories"
    ADD CONSTRAINT "target_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."target_responses"
    ADD CONSTRAINT "target_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."target_responses"
    ADD CONSTRAINT "target_responses_provider_id_fkey" FOREIGN KEY ("provider_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE SET NULL ("provider_id");



ALTER TABLE ONLY "public"."target_responses"
    ADD CONSTRAINT "target_responses_session_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "public"."sessions"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."target_responses"
    ADD CONSTRAINT "target_responses_session_target_id_fkey" FOREIGN KEY ("session_target_id", "session_id", "organization_id") REFERENCES "public"."session_targets"("id", "session_id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_completions"
    ADD CONSTRAINT "task_completions_task_id_fkey" FOREIGN KEY ("task_id", "organization_id") REFERENCES "public"."tasks"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_completions"
    ADD CONSTRAINT "task_completions_teacher_id_fkey" FOREIGN KEY ("teacher_id", "organization_id") REFERENCES "public"."users"("id", "organization_id");



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_child_id_fkey" FOREIGN KEY ("child_id", "organization_id") REFERENCES "public"."children"("id", "organization_id");



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_classroom_id_fkey" FOREIGN KEY ("classroom_id", "organization_id") REFERENCES "public"."classrooms"("id", "organization_id");



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_templates"
    ADD CONSTRAINT "task_templates_teacher_id_fkey" FOREIGN KEY ("teacher_id", "organization_id") REFERENCES "public"."users"("id", "organization_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_child_id_fkey" FOREIGN KEY ("child_id", "organization_id") REFERENCES "public"."children"("id", "organization_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_teacher_id_fkey" FOREIGN KEY ("teacher_id", "organization_id") REFERENCES "public"."users"("id", "organization_id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "rejoyce_security"."organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id");



CREATE POLICY "Admins can manage organization terminology" ON "public"."organization_terminology" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND ("public"."can_manage_clients"() OR "public"."can_manage_sessions"()))) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND ("public"."can_manage_clients"() OR "public"."can_manage_sessions"())));



CREATE POLICY "Assigned providers can view behavior events" ON "public"."behavior_events" FOR SELECT TO "authenticated" USING ("public"."is_assigned_session_provider"("session_id"));



CREATE POLICY "Assigned providers can view session notes" ON "public"."session_notes" FOR SELECT TO "authenticated" USING ("public"."is_assigned_session_provider"("session_id"));



CREATE POLICY "Assigned providers can view session targets" ON "public"."session_targets" FOR SELECT TO "authenticated" USING ("public"."is_assigned_session_provider"("session_id"));



CREATE POLICY "Assigned providers can view sessions" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND ("provider_id" = "auth"."uid"())));



CREATE POLICY "Assigned providers can view target responses" ON "public"."target_responses" FOR SELECT TO "authenticated" USING ("public"."is_assigned_session_provider"("session_id"));



CREATE POLICY "Assigned staff can view client behaviors" ON "public"."client_behaviors" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_access_client"("client_id")));



CREATE POLICY "Assigned staff can view client targets" ON "public"."client_targets" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_access_client"("client_id")));



CREATE POLICY "Assigned staff can view clients" ON "public"."clients" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_access_client"("id")));



CREATE POLICY "Client managers assign branches" ON "public"."client_locations" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "public"."can_manage_clients"() AS "can_manage_clients") AND (EXISTS ( SELECT 1
   FROM "public"."organization_locations" "l"
  WHERE (("l"."id" = "client_locations"."location_id") AND ("l"."organization_id" = "client_locations"."organization_id") AND "l"."active")))));



CREATE POLICY "Client managers can create clients" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"()));



CREATE POLICY "Client managers can manage client behaviors" ON "public"."client_behaviors" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"()));



CREATE POLICY "Client managers can manage client targets" ON "public"."client_targets" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"()));



CREATE POLICY "Client managers can manage target categories" ON "public"."target_categories" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"()));



CREATE POLICY "Client managers can update clients" ON "public"."clients" FOR UPDATE TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_clients"()));



CREATE POLICY "Client managers can view organization clients" ON "public"."clients" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND ("public"."can_manage_clients"() OR "public"."can_manage_sessions"())));



CREATE POLICY "Client managers remove branches" ON "public"."client_locations" FOR DELETE TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "public"."can_manage_clients"() AS "can_manage_clients")));



CREATE POLICY "Frontline staff can view assigned client behaviors" ON "public"."client_behaviors" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_frontline_staff"() AS "is_frontline_staff") AND ("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "public"."is_assigned_to_client"("client_behaviors"."client_id") AS "is_assigned_to_client")));



CREATE POLICY "Frontline staff can view assigned clients" ON "public"."clients" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_frontline_staff"() AS "is_frontline_staff") AND ("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "public"."is_assigned_to_client"("clients"."id") AS "is_assigned_to_client")));



CREATE POLICY "Frontline staff can view assigned sessions" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_frontline_staff"() AS "is_frontline_staff") AND ("provider_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id"))));



CREATE POLICY "Insert classrooms in org" ON "public"."classrooms" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Insert tasks in org" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Insert templates in org" ON "public"."task_templates" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Managers can create organization permissions" ON "public"."user_permissions" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_org_user"("user_id")));



CREATE POLICY "Managers can update organization permissions" ON "public"."user_permissions" FOR UPDATE TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_org_user"("user_id"))) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_org_user"("user_id")));



CREATE POLICY "Managers can view organization permissions" ON "public"."user_permissions" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_users"()));



CREATE POLICY "Reviewers can view behavior events" ON "public"."behavior_events" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_review_sessions"()));



CREATE POLICY "Reviewers can view session notes" ON "public"."session_notes" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_review_sessions"()));



CREATE POLICY "Reviewers can view target responses" ON "public"."target_responses" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_review_sessions"()));



CREATE POLICY "Session managers can create sessions" ON "public"."sessions" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"()));



CREATE POLICY "Session managers can manage organization locations" ON "public"."organization_locations" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"()));



CREATE POLICY "Session managers can manage session targets" ON "public"."session_targets" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"()));



CREATE POLICY "Session managers can manage session types" ON "public"."session_types" TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"()));



CREATE POLICY "Session managers can update sessions" ON "public"."sessions" FOR UPDATE TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"())) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_sessions"()));



CREATE POLICY "Session managers can view organization sessions" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND ("public"."can_manage_sessions"() OR "public"."can_review_sessions"())));



CREATE POLICY "Session managers can view session types" ON "public"."session_types" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "User managers can create organization users" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND ("role" <> 'owner'::"text") AND "public"."can_manage_users"() AND "public"."can_assign_org_role"("role")));



CREATE POLICY "User managers can update organization users" ON "public"."users" FOR UPDATE TO "authenticated" USING ("public"."can_manage_org_user"("id")) WITH CHECK ((("organization_id" = "public"."current_organization_id"()) AND ("id" <> "auth"."uid"()) AND ("role" <> 'owner'::"text") AND "public"."can_manage_users"() AND "public"."can_assign_org_role"("role")));



CREATE POLICY "User managers can view organization users" ON "public"."users" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."current_organization_id"()) AND "public"."can_manage_users"()));



CREATE POLICY "Users can access children in org" ON "public"."children" TO "authenticated" USING (("organization_id" = "public"."current_organization_id"())) WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can access classrooms in org" ON "public"."classrooms" TO "authenticated" USING (("organization_id" = "public"."current_organization_id"())) WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can access generated tasks in org" ON "public"."daily_tasks" TO "authenticated" USING (("organization_id" = "public"."current_organization_id"())) WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can access task completions in org" ON "public"."task_completions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tasks"
  WHERE (("tasks"."id" = "task_completions"."task_id") AND ("tasks"."organization_id" = "public"."current_organization_id"())))));



CREATE POLICY "Users can access tasks in org" ON "public"."tasks" TO "authenticated" USING (("organization_id" = "public"."current_organization_id"())) WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can access templates in org" ON "public"."task_templates" TO "authenticated" USING (("organization_id" = "public"."current_organization_id"())) WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can add children to their daycare" ON "public"."children" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can only see their daycare data" ON "public"."children" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can view organization locations" ON "public"."organization_locations" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can view organization target categories" ON "public"."target_categories" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can view organization terminology" ON "public"."organization_terminology" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."current_organization_id"()));



CREATE POLICY "Users can view own permissions" ON "public"."user_permissions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Users can view their organization" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("id" = "public"."current_organization_id"()));



CREATE POLICY "Visible client branches" ON "public"."client_locations" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND (EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE ("c"."id" = "client_locations"."client_id")))));



ALTER TABLE "public"."activity_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."behavior_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."children" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."classrooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_behaviors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_login_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generated_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "history_device" ON "public"."session_note_history" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "history_read" ON "public"."session_note_history" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND (( SELECT "public"."can_review_sessions"() AS "can_review_sessions") OR ( SELECT "rejoyce_security"."is_note_admin"() AS "is_note_admin") OR "public"."is_assigned_session_provider"("session_id"))));



CREATE POLICY "note_admin_read" ON "public"."session_notes" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "rejoyce_security"."is_note_admin"() AS "is_note_admin")));



CREATE POLICY "note_admin_session_read" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "rejoyce_security"."is_note_admin"() AS "is_note_admin")));



ALTER TABLE "public"."organization_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_terminology" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."owner_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pin_login_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "remarks_device" ON "public"."session_note_remarks" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "remarks_read" ON "public"."session_note_remarks" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND (( SELECT "public"."can_review_sessions"() AS "can_review_sessions") OR ( SELECT "rejoyce_security"."is_note_admin"() AS "is_note_admin") OR "public"."is_assigned_session_provider"("session_id"))));



CREATE POLICY "require_unlocked_device" ON "public"."activity_logs" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."behavior_events" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."children" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."classrooms" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."client_behaviors" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."client_locations" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."client_targets" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."clients" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."daily_tasks" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."generated_tasks" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."organization_locations" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."organization_terminology" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."organizations" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."owner_requests" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."session_notes" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."session_targets" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."session_types" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."sessions" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."system_admins" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."target_categories" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."target_responses" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."task_completions" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."task_templates" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."tasks" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."user_permissions" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "require_unlocked_device" ON "public"."users" AS RESTRICTIVE TO "authenticated" USING (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked")) WITH CHECK (( SELECT "rejoyce_security"."session_is_unlocked"() AS "session_is_unlocked"));



CREATE POLICY "reviewer_target_read" ON "public"."session_targets" FOR SELECT TO "authenticated" USING ((("organization_id" = ( SELECT "public"."current_organization_id"() AS "current_organization_id")) AND ( SELECT "public"."can_review_sessions"() AS "can_review_sessions")));



CREATE POLICY "server_only" ON "public"."device_sessions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "server_only" ON "public"."email_login_challenges" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "server_only" ON "public"."pin_login_attempts" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."session_note_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_note_remarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."target_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."target_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "rejoyce_security"."organization_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_server" ON "rejoyce_security"."organization_subscriptions" TO "service_role" USING (true) WITH CHECK (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "rejoyce_security" TO "authenticated";
GRANT USAGE ON SCHEMA "rejoyce_security" TO "service_role";



GRANT ALL ON TABLE "public"."session_note_remarks" TO "service_role";
GRANT SELECT ON TABLE "public"."session_note_remarks" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_session_note"("p_note_id" "uuid", "p_review_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_session_note"("p_note_id" "uuid", "p_review_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_client"("requested_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_client"("requested_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_client"("requested_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_reports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_reports"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_assign_org_role"("requested_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_assign_org_role"("requested_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_assign_org_role"("requested_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_billing"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_billing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_billing"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_clients"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_clients"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_clients"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_org_user"("requested_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_org_user"("requested_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_org_user"("requested_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_requested_user"("requested_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_requested_user"("requested_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_requested_user"("requested_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_review_session_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_review_session_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_review_session_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_review_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_review_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_review_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_reports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_reports"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_client_with_locations"("p_first_name" "text", "p_last_name" "text", "p_preferred_name" "text", "p_assigned_provider_id" "uuid", "p_location_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_client_with_locations"("p_first_name" "text", "p_last_name" "text", "p_preferred_name" "text", "p_assigned_provider_id" "uuid", "p_location_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_client_with_locations"("p_first_name" "text", "p_last_name" "text", "p_preferred_name" "text", "p_assigned_provider_id" "uuid", "p_location_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_prepared_session"("requested_client_id" "uuid", "requested_provider_id" "uuid", "requested_scheduled_start" timestamp with time zone, "requested_scheduled_end" timestamp with time zone, "requested_session_type" "text", "requested_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_prepared_session"("requested_client_id" "uuid", "requested_provider_id" "uuid", "requested_scheduled_start" timestamp with time zone, "requested_scheduled_end" timestamp with time zone, "requested_session_type" "text", "requested_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_prepared_session"("requested_client_id" "uuid", "requested_provider_id" "uuid", "requested_scheduled_start" timestamp with time zone, "requested_scheduled_end" timestamp with time zone, "requested_session_type" "text", "requested_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_self_service_organization"("p_user_id" "uuid", "p_session_id" "uuid", "p_name" "text", "p_full_name" "text", "p_branch_name" "text", "p_organization_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_self_service_organization"("p_user_id" "uuid", "p_session_id" "uuid", "p_name" "text", "p_full_name" "text", "p_branch_name" "text", "p_organization_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_organization_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_organization_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."device_policy_enabled"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."device_policy_enabled"() TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sessions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."finish_assigned_session"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finish_assigned_session"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finish_assigned_session"("requested_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_tasks"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_auth_user_email_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_auth_user_email_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_org_permission"("requested_permission" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_org_permission"("requested_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_org_permission"("requested_permission" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_assigned_session_provider"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_assigned_session_provider"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assigned_session_provider"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_assigned_to_client"("requested_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_assigned_to_client"("requested_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assigned_to_client"("requested_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_assigned_to_session"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_assigned_to_session"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assigned_to_session"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_frontline_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_frontline_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_frontline_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_organization_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_organization_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_organization_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_organization_owner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_organization_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_organization_owner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_same_organization"("requested_organization_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_same_organization"("requested_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_same_organization"("requested_organization_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_user_org_owner"("requested_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_user_org_owner"("requested_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_org_owner"("requested_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_session_note"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_session_note"("p_note_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."manage_device_session"("p_user_id" "uuid", "p_session_id" "uuid", "p_action" "text", "p_proof_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."manage_device_session"("p_user_id" "uuid", "p_session_id" "uuid", "p_action" "text", "p_proof_hash" "text") TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_notes" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."session_notes" TO "service_role";



REVOKE ALL ON FUNCTION "public"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."organization_write_access"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."organization_write_access"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pause_assigned_session"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pause_assigned_session"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pause_assigned_session"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_session_targets"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_session_targets"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_session_targets"("requested_session_id" "uuid") TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."behavior_events" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."behavior_events" TO "authenticated";
GRANT ALL ON TABLE "public"."behavior_events" TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid", "requested_duration_seconds" integer, "requested_intensity_level" integer, "requested_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid", "requested_duration_seconds" integer, "requested_intensity_level" integer, "requested_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid", "requested_duration_seconds" integer, "requested_intensity_level" integer, "requested_notes" "text") TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."target_responses" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."target_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."target_responses" TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_target_response"("requested_session_target_id" "uuid", "requested_result" "text", "requested_prompt_level" "text", "requested_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_target_response"("requested_session_target_id" "uuid", "requested_result" "text", "requested_prompt_level" "text", "requested_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_target_response"("requested_session_target_id" "uuid", "requested_result" "text", "requested_prompt_level" "text", "requested_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_pin_login_attempt"("p_account_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_pin_login_attempt"("p_account_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resume_assigned_session"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resume_assigned_session"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resume_assigned_session"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."return_session_note_for_correction"("p_note_id" "uuid", "p_review_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."return_session_note_for_correction"("p_note_id" "uuid", "p_review_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_assigned_session_note_draft"("requested_session_id" "uuid", "requested_therapist_addendum" "text", "requested_final_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_assigned_session_note_draft"("requested_session_id" "uuid", "requested_therapist_addendum" "text", "requested_final_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_client_locations"("p_client_id" "uuid", "p_location_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_client_locations"("p_client_id" "uuid", "p_location_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_client_locations"("p_client_id" "uuid", "p_location_ids" "uuid"[]) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_assigned_session"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_assigned_session"("requested_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_assigned_session"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_assigned_session_note"("requested_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_assigned_session_note"("requested_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_session_note_for_review"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_session_note_for_review"("p_note_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."subscription_access"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."subscription_access"("p_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."subscription_access"("p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."undo_latest_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."undo_latest_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."undo_latest_behavior_event"("requested_session_id" "uuid", "requested_client_behavior_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "rejoyce_security"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."append_session_note_remark"("p_session_id" "uuid", "p_body" "text", "p_operation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "rejoyce_security"."derive_session_client"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."derive_task_organization"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."guard_billing_permission"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."guard_permission_delegation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."guard_service_session"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."guard_session_target"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."guard_subscription_write"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."is_note_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."is_note_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "rejoyce_security"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."mutate_session_note"("p_session_id" "uuid", "p_action" "text", "p_version" integer, "p_operation_id" "uuid", "p_final_note" "text", "p_addendum" "text", "p_feedback" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "rejoyce_security"."organization_can_write"("p_organization_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."prevent_tenant_reassignment"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."require_unlocked"() FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."require_unlocked"() TO "authenticated";
GRANT ALL ON FUNCTION "rejoyce_security"."require_unlocked"() TO "service_role";



REVOKE ALL ON FUNCTION "rejoyce_security"."session_is_unlocked"() FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."session_is_unlocked"() TO "authenticated";
GRANT ALL ON FUNCTION "rejoyce_security"."session_is_unlocked"() TO "service_role";



REVOKE ALL ON FUNCTION "rejoyce_security"."session_trial_exception"("p_session_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "rejoyce_security"."subscription_access"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."subscription_access"("p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "rejoyce_security"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "rejoyce_security"."swap_session_targets"("p_session_id" "uuid", "p_first" "uuid", "p_second" "uuid", "p_first_order" integer, "p_second_order" integer) TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."activity_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."children" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."children" TO "authenticated";
GRANT ALL ON TABLE "public"."children" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."classrooms" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."classrooms" TO "authenticated";
GRANT ALL ON TABLE "public"."classrooms" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."client_behaviors" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."client_behaviors" TO "authenticated";
GRANT ALL ON TABLE "public"."client_behaviors" TO "service_role";



GRANT ALL ON TABLE "public"."client_locations" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."client_locations" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."client_targets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."client_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."client_targets" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."clients" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."daily_tasks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."daily_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."device_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."email_login_challenges" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."generated_tasks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."generated_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."generated_tasks" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organization_locations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organization_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_locations" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organization_terminology" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organization_terminology" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_terminology" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organizations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."owner_requests" TO "service_role";



GRANT ALL ON TABLE "public"."pin_login_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."session_note_history" TO "service_role";
GRANT SELECT ON TABLE "public"."session_note_history" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_targets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."session_targets" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_types" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."session_types" TO "authenticated";
GRANT ALL ON TABLE "public"."session_types" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."system_admins" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."system_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."system_admins" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."target_categories" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."target_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."target_categories" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_completions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_completions" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_templates" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."task_templates" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tasks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_permissions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permissions" TO "service_role";



GRANT DELETE ON TABLE "public"."users" TO "anon";
GRANT DELETE ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("organization_id") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("full_name"),UPDATE("full_name") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("role"),UPDATE("role") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("username") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("is_active") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("status"),UPDATE("status") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("email") ON TABLE "public"."users" TO "authenticated";



GRANT SELECT("pin_reset_required"),UPDATE("pin_reset_required") ON TABLE "public"."users" TO "authenticated";



GRANT ALL ON TABLE "rejoyce_security"."organization_subscriptions" TO "service_role";



GRANT SELECT ON TABLE "rejoyce_security"."session_policy" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








