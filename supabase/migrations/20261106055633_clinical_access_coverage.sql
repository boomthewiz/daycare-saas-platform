BEGIN;
-- Existing explicit program-read approval is necessary, never sufficient, for
-- clinical delivery/review. Provider, review, tenant, device and billing rules remain.
CREATE FUNCTION rejoyce_security.clinical_actor_allowed(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_org=public.current_organization_id() AND rejoyce_security.session_is_unlocked()
 AND EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 WHERE u.id=auth.uid() AND s.id::text=auth.jwt()->>'session_id'
 AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
 AND (s.not_after IS NULL OR s.not_after>statement_timestamp()))
 AND EXISTS(SELECT 1 FROM rejoyce_security.clinical_modules WHERE organization_id=p_org AND enabled)
 AND EXISTS(SELECT 1 FROM rejoyce_security.clinical_program_grants WHERE organization_id=p_org AND user_id=auth.uid() AND program_read),false)
$$;

-- Live identity is independent of device-policy enforcement and cached JWTs.
DO $identity$ DECLARE f regprocedure:='rejoyce_security.clinical_program_allowed(uuid,uuid,boolean)'::regprocedure; body text; BEGIN
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'f7ef8e54ff82e4016e3c43a52396f678' THEN RAISE EXCEPTION 'Clinical predecessor changed: clinical_program_allowed'; END IF;
 EXECUTE replace(pg_get_functiondef(f),(SELECT prosrc FROM pg_proc WHERE oid=f),replace(body,'SELECT coalesce(rejoyce_security.session_is_unlocked()','SELECT coalesce(rejoyce_security.clinical_actor_allowed(p_org) AND rejoyce_security.session_is_unlocked()'));
END $identity$;
CREATE FUNCTION rejoyce_security.clinical_session_allowed(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=p_session AND s.workflow_intent='clinical'
 AND rejoyce_security.clinical_program_allowed(s.organization_id,s.client_id,false))
$$;
CREATE FUNCTION rejoyce_security.require_clinical_client(p_client uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=public.current_organization_id();
BEGIN
 -- Revocation serializes with writes; no client-set GUC can manufacture approval.
 -- Reject snapshot isolation so a waiter cannot retain pre-revocation authority.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Clinical writes require current authorization' USING ERRCODE='25000';
 END IF;
 PERFORM 1 FROM rejoyce_security.clinical_modules WHERE organization_id=org FOR SHARE;
 PERFORM 1 FROM rejoyce_security.clinical_program_grants WHERE organization_id=org AND user_id=auth.uid() FOR SHARE;
 IF NOT rejoyce_security.clinical_program_allowed(org,p_client,false) THEN
  RAISE EXCEPTION 'Clinical record unavailable' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION rejoyce_security.require_clinical_session(p_session uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE child uuid;
BEGIN
 SELECT client_id INTO child FROM public.sessions WHERE id=p_session AND organization_id=public.current_organization_id() AND workflow_intent='clinical';
 IF child IS NULL THEN RAISE EXCEPTION 'Clinical record unavailable' USING ERRCODE='42501'; END IF;
 PERFORM rejoyce_security.require_clinical_client(child);
END $$;
CREATE FUNCTION rejoyce_security.require_visible_session(p_session uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=p_session AND s.organization_id=public.current_organization_id()
 AND rejoyce_security.session_is_unlocked() AND (s.workflow_intent='activity' OR rejoyce_security.clinical_session_allowed(s.id))) THEN
  RAISE EXCEPTION 'Scheduled record unavailable' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION rejoyce_security.guard_clinical_session_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL OR current_setting('role',true) IN ('authenticated','anon') THEN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.workflow_intent='clinical' THEN PERFORM rejoyce_security.require_clinical_client(OLD.client_id); END IF;
  IF TG_OP<>'DELETE' AND NEW.workflow_intent='clinical' THEN
   IF NEW.organization_id IS DISTINCT FROM public.current_organization_id() THEN RAISE EXCEPTION 'Clinical record unavailable' USING ERRCODE='42501'; END IF;
   PERFORM rejoyce_security.require_clinical_client(NEW.client_id);
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER clinical_access BEFORE INSERT OR UPDATE OR DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_session_access();

CREATE FUNCTION rejoyce_security.guard_clinical_record_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL OR current_setting('role',true) IN ('authenticated','anon') THEN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM rejoyce_security.require_clinical_session(OLD.session_id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM rejoyce_security.require_clinical_session(NEW.session_id); END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['session_targets','target_responses','behavior_events','session_notes','session_note_history','session_note_remarks'] LOOP
  EXECUTE format('CREATE POLICY clinical_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (rejoyce_security.clinical_session_allowed(session_id)) WITH CHECK (rejoyce_security.clinical_session_allowed(session_id))',t);
  EXECUTE format('CREATE TRIGGER clinical_access BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_record_access()',t);
 END LOOP;
END $$;
CREATE POLICY clinical_access ON public.sessions AS RESTRICTIVE FOR ALL TO authenticated
 USING (workflow_intent='activity' OR rejoyce_security.clinical_program_allowed(organization_id,client_id,false))
 WITH CHECK (workflow_intent='activity' OR rejoyce_security.clinical_program_allowed(organization_id,client_id,false));

REVOKE ALL ON FUNCTION rejoyce_security.clinical_actor_allowed(uuid),rejoyce_security.clinical_session_allowed(uuid),rejoyce_security.require_clinical_client(uuid),rejoyce_security.require_clinical_session(uuid),rejoyce_security.require_visible_session(uuid),rejoyce_security.guard_clinical_session_access(),rejoyce_security.guard_clinical_record_access() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rejoyce_security.clinical_actor_allowed(uuid),rejoyce_security.clinical_session_allowed(uuid) TO authenticated;

-- Exact predecessor source guards: production definitions reconciled before release.
DO $patch$
DECLARE f regprocedure; body text; definition text;
BEGIN
 f:='public.prepare_session_targets(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'abc09a37a430fdfdd6b86d20d67a12bc' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.prepare_session_targets'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  selected_session public.sessions%rowtype;
  inserted_count integer;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.start_assigned_session(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'6a783b01dd106017acc5eeb1b68e612e' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.start_assigned_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  updated_session public.sessions%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.pause_assigned_session(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'5bf07afce1256f99500394d5c2cbe377' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.pause_assigned_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  updated_session public.sessions%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.resume_assigned_session(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'ab864790053e227d84f14f7f13bdaae4' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.resume_assigned_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  updated_session public.sessions%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.finish_assigned_session(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'91306c52fb7dcf075f726f23b5070c99' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.finish_assigned_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  updated_session public.sessions%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.record_behavior_event(uuid,uuid,integer,integer,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'315acdac20af61c6349fe60f2a938d1f' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.record_behavior_event'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  selected_session public.sessions%rowtype;
  selected_behavior public.client_behaviors%rowtype;
  inserted_event public.behavior_events%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.undo_latest_behavior_event(uuid,uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'e1340c8f958940a8679a2c8e89951030' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.undo_latest_behavior_event'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  event_to_remove uuid;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.save_assigned_session_note_draft(uuid,text,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'c53c383080eb4db007e22af67c434993' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.save_assigned_session_note_draft'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  selected_session public.sessions%rowtype;
  existing_note public.session_notes%rowtype;
  saved_note public.session_notes%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.submit_assigned_session_note(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'adef8cf62d1a16486b1e99196b0324a7' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.submit_assigned_session_note'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  selected_note public.session_notes%rowtype;
  submitted_note public.session_notes%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session(requested_session_id);
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
$body$);
 f:='public.approve_session_note(uuid,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'69970fb17bac506a9d925a9839fc7286' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.approve_session_note'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  v_organization_id uuid;
  v_status text;
begin
 PERFORM rejoyce_security.require_clinical_session((SELECT session_id FROM public.session_notes WHERE id=p_note_id));
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
$body$);
 f:='public.return_session_note_for_correction(uuid,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'800a52fd1d2a9587360b80ff12500f0e' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.return_session_note_for_correction'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  v_organization_id uuid;
  v_status text;
begin
 PERFORM rejoyce_security.require_clinical_session((SELECT session_id FROM public.session_notes WHERE id=p_note_id));
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
$body$);
 f:='public.lock_session_note(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'be8b9c96ca678068d0ac6e01df816939' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.lock_session_note'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  v_organization_id uuid;
  v_status text;
begin
 PERFORM rejoyce_security.require_clinical_session((SELECT session_id FROM public.session_notes WHERE id=p_note_id));
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
$body$);
 f:='public.submit_session_note_for_review(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'5771b20cffe627252f5c3f81f2b996a5' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.submit_session_note_for_review'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  v_session_id uuid;
  v_organization_id uuid;
  v_status text;
begin
 PERFORM rejoyce_security.require_clinical_session((SELECT session_id FROM public.session_notes WHERE id=p_note_id));
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
$body$);
 f:='public.record_target_response(uuid,text,text,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'264c5d846f0c8be0bb21d42f6d138590' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.record_target_response'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  selected_target public.session_targets%rowtype;
  next_trial_number integer;
  inserted_response public.target_responses%rowtype;
begin
 PERFORM rejoyce_security.require_clinical_session((SELECT session_id FROM public.session_targets WHERE id=requested_session_target_id));
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
$body$);
 f:='public.create_prepared_session(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'f675c0ca3bc66c0f719bcb5c7ea72dfb' THEN RAISE EXCEPTION 'Clinical predecessor changed: public.create_prepared_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
declare
  current_org_id uuid;
  selected_client public.clients%rowtype;
  selected_provider public.users%rowtype;
  created_session public.sessions%rowtype;
  inserted_target_count integer;
begin
 PERFORM rejoyce_security.require_clinical_client(requested_client_id);
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
$body$);
 f:='rejoyce_security.mutate_session_note(uuid,text,integer,uuid,text,text,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'84e4d1baa0aa15c0ad6123c2126b010b' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.mutate_session_note'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE
 s public.sessions%rowtype; n public.session_notes%rowtype; prior public.session_note_history%rowtype;
 actor public.users%rowtype; payload jsonb; stamp timestamptz := clock_timestamp();
BEGIN
 PERFORM rejoyce_security.require_clinical_session(p_session_id);
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
$body$);
 f:='rejoyce_security.append_session_note_remark(uuid,text,uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'f147f3b8c8c2d9aa70eb8fe3634880cb' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.append_session_note_remark'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE actor public.users%rowtype; n public.session_notes%rowtype; r public.session_note_remarks%rowtype;
BEGIN
 PERFORM rejoyce_security.require_clinical_session(p_session_id);
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
$body$);
 f:='rejoyce_security.swap_session_targets(uuid,uuid,uuid,integer,integer)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'1fb5634c72329d3275ffa2df45f8e0ac' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.swap_session_targets'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE s public.sessions%rowtype; a public.session_targets%rowtype; b public.session_targets%rowtype;
BEGIN
 PERFORM rejoyce_security.require_clinical_session(p_session_id);
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
$body$);
 f:='rejoyce_security.create_context_session(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,uuid[],uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'7535d231b0afb6d1c8a0e584e3342d93' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.create_context_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; payload jsonb; saved rejoyce_security.session_creation_operations%rowtype; result jsonb; tag_ids uuid[]; duration integer;
BEGIN
 PERFORM rejoyce_security.require_clinical_client(p_child);
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_operation IS NULL OR p_tags IS NULL OR cardinality(p_tags)>20 OR array_position(p_tags,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose at most 20 valid tags and an operation ID' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO tag_ids FROM unnest(p_tags) id;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation) THEN RAISE EXCEPTION 'Save attempt canceled; start a new operation' USING ERRCODE='40001'; END IF;
 payload:=jsonb_build_object('child',p_child,'provider',p_provider,'start',p_start,'end',p_end,'type',p_type,'location',p_location,'tags',tag_ids);
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() OR saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Operation ID reused with different details' USING ERRCODE='40001'; END IF;
  RETURN saved.result;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(tag_ids) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices c WHERE c.id=requested.id AND c.organization_id=org AND c.active AND c.kind='tag')) THEN RAISE EXCEPTION 'Tag unavailable; reload choices' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '24 hours' THEN RAISE EXCEPTION 'Choose valid session times within 24 hours' USING ERRCODE='22023'; END IF;
 IF length(p_location)>120 THEN RAISE EXCEPTION 'Location is too long' USING ERRCODE='22023'; END IF;
 result:=public.create_prepared_session(p_child,p_provider,p_start,p_end,p_type,p_location);
 INSERT INTO rejoyce_security.session_tags(organization_id,session_id,choice_id,label_snapshot,domain_snapshot)
 SELECT org,(result->>'session_id')::uuid,id,label,domain FROM rejoyce_security.session_choices WHERE id=ANY(tag_ids) AND organization_id=org;
 duration:=greatest(1,ceil(extract(epoch FROM (p_end-p_start))/60)::integer);
 INSERT INTO rejoyce_security.session_recent_choices(organization_id,user_id,child_id,provider_id,session_type,location,tag_ids,duration_minutes) VALUES(org,auth.uid(),p_child,p_provider,p_type,p_location,tag_ids,duration);
 DELETE FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() AND id NOT IN(SELECT id FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() ORDER BY used_at DESC,id LIMIT 10);
 INSERT INTO rejoyce_security.session_creation_operations VALUES(org,p_operation,auth.uid(),payload,result);
 RETURN result;
END; $body$);
 f:='rejoyce_security.create_scheduled_context_session(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,uuid[],uuid,text)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'ad7165d207885868854be58f2a422005' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.create_scheduled_context_session'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; payload jsonb; saved rejoyce_security.session_creation_operations%rowtype; result jsonb; tag_ids uuid[]; duration integer; created_id uuid;
BEGIN
 IF p_intent='clinical' THEN PERFORM rejoyce_security.require_clinical_client(p_child); END IF;
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_intent IS NULL OR p_intent NOT IN ('activity','clinical') THEN RAISE EXCEPTION 'Choose activity or clinical intent' USING ERRCODE='22023'; END IF;
 IF p_operation IS NULL OR p_tags IS NULL OR cardinality(p_tags)>20 OR array_position(p_tags,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose at most 20 valid tags and an operation ID' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO tag_ids FROM unnest(p_tags) id;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation) THEN RAISE EXCEPTION 'Save attempt canceled; start a new operation' USING ERRCODE='40001'; END IF;
 payload:=jsonb_build_object('child',p_child,'provider',p_provider,'start',p_start,'end',p_end,'type',p_type,'location',p_location,'tags',tag_ids);
 IF p_intent='activity' THEN payload:=payload||jsonb_build_object('intent',p_intent); END IF;
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() OR saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Operation ID reused with different details' USING ERRCODE='40001'; END IF;
  RETURN saved.result;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(tag_ids) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices c WHERE c.id=requested.id AND c.organization_id=org AND c.active AND c.kind='tag')) THEN RAISE EXCEPTION 'Tag unavailable; reload choices' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '24 hours' THEN RAISE EXCEPTION 'Choose valid session times within 24 hours' USING ERRCODE='22023'; END IF;
 IF length(p_location)>120 THEN RAISE EXCEPTION 'Location is too long' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND code=p_type AND active) THEN RAISE EXCEPTION 'Activity type unavailable; reload choices' USING ERRCODE='42501'; END IF;
 IF p_intent='clinical' THEN
  result:=public.create_prepared_session(p_child,p_provider,p_start,p_end,p_type,p_location);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_child AND organization_id=org AND status='active') OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_provider AND organization_id=org AND status='active') THEN RAISE EXCEPTION 'Current child and assigned staff required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.sessions(organization_id,client_id,provider_id,session_type,workflow_intent,status,attendance_status,scheduled_start,scheduled_end,location)
  VALUES(org,p_child,p_provider,p_type,'activity','confirmed','unconfirmed',p_start,p_end,nullif(btrim(p_location),'')) RETURNING id INTO created_id;
  result:=jsonb_build_object('session_id',created_id,'client_id',p_child,'provider_id',p_provider,'scheduled_start',p_start,'scheduled_end',p_end,'status','confirmed','targets_added',0,'workflow_intent','activity');
 END IF;
 INSERT INTO rejoyce_security.session_tags(organization_id,session_id,choice_id,label_snapshot,domain_snapshot)
 SELECT org,(result->>'session_id')::uuid,id,label,domain FROM rejoyce_security.session_choices WHERE id=ANY(tag_ids) AND organization_id=org;
 duration:=greatest(1,ceil(extract(epoch FROM (p_end-p_start))/60)::integer);
 INSERT INTO rejoyce_security.session_recent_choices(organization_id,user_id,child_id,provider_id,session_type,location,tag_ids,duration_minutes,workflow_intent) VALUES(org,auth.uid(),p_child,p_provider,p_type,p_location,tag_ids,duration,p_intent);
 DELETE FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() AND id NOT IN(SELECT id FROM rejoyce_security.session_recent_choices WHERE organization_id=org AND user_id=auth.uid() ORDER BY used_at DESC,id LIMIT 10);
 INSERT INTO rejoyce_security.session_creation_operations VALUES(org,p_operation,auth.uid(),payload,result);
 RETURN result;
END; $body$);
 f:='rejoyce_security.session_context(uuid)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'57564087d50a5b3f4e37eba32e13dc5d' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.session_context'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; choices jsonb; recent jsonb; tags jsonb;
BEGIN
 IF p_session IS NOT NULL THEN PERFORM rejoyce_security.require_visible_session(p_session); END IF;
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management required' USING ERRCODE='42501'; END IF;
 IF p_session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sessions WHERE id=p_session AND organization_id=org) THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.label,q.id),'[]') INTO choices FROM (SELECT id,kind,label,domain,active FROM rejoyce_security.session_choices WHERE organization_id=org AND active ORDER BY label,id LIMIT 500) q;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.used_at DESC,q.id),'[]') INTO recent FROM (
  SELECT r.id,r.child_id,r.provider_id,r.session_type,r.location,r.tag_ids,r.duration_minutes,r.workflow_intent,r.used_at
  FROM rejoyce_security.session_recent_choices r
  WHERE r.organization_id=org AND r.user_id=auth.uid() AND (r.workflow_intent='activity' OR rejoyce_security.clinical_program_allowed(r.organization_id,r.child_id,false))
  AND EXISTS(SELECT 1 FROM public.clients WHERE id=r.child_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.users WHERE id=r.provider_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND code=r.session_type AND active)
  AND NOT EXISTS(SELECT 1 FROM unnest(r.tag_ids) tag WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices WHERE id=tag AND organization_id=org AND active AND kind='tag'))
  ORDER BY r.used_at DESC,r.id LIMIT 10
 ) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',choice_id,'label',label_snapshot,'domain',domain_snapshot) ORDER BY label_snapshot,choice_id),'[]') INTO tags FROM rejoyce_security.session_tags WHERE organization_id=org AND session_id=p_session;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'choices',choices,'recent',recent,'tags',tags);
END; $body$);
 f:='rejoyce_security.recover_session_creation(uuid,boolean)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'32fb799c0a2a00683c0c7103fdc652ef' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.recover_session_creation'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; saved rejoyce_security.session_creation_operations%rowtype; actor uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF org IS NULL OR NOT public.can_manage_sessions() OR p_operation IS NULL OR p_cancel IS NULL THEN RAISE EXCEPTION 'Session management and operation required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO saved FROM rejoyce_security.session_creation_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.actor_id<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM rejoyce_security.require_visible_session((saved.result->>'session_id')::uuid);
  RETURN jsonb_build_object('state','committed','session_id',saved.result->>'session_id');
 END IF;
 SELECT actor_id INTO actor FROM rejoyce_security.canceled_session_operations WHERE organization_id=org AND operation_id=p_operation;
 IF FOUND THEN
  IF actor<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('state','canceled');
 END IF;
 IF p_cancel THEN
  IF NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Editing access required' USING ERRCODE='42501'; END IF;
  INSERT INTO rejoyce_security.canceled_session_operations VALUES(org,p_operation,auth.uid());
  RETURN jsonb_build_object('state','canceled');
 END IF;
 RETURN jsonb_build_object('state','unconfirmed');
END; $body$);
 f:='rejoyce_security.conflict_proposal_before_timezone(text,jsonb)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'ee0021bb758e1cef8e4b3fa503e32f75' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.conflict_proposal_before_timezone'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; children uuid[]; staff uuid[]; from_at timestamptz; to_at timestamptz; excluded uuid; kind text; skip boolean:=false;
 s public.sessions%rowtype; next_s public.sessions%rowtype; g rejoyce_security.group_activities%rowtype; k text;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Scheduling management required' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>20000 THEN RAISE EXCEPTION 'Invalid scheduling proposal' USING ERRCODE='22023'; END IF;
 IF p_action='create_session' THEN
  kind:=p_payload->>'p_intent'; children:=ARRAY[(p_payload->>'p_child')::uuid]; staff:=ARRAY[(p_payload->>'p_provider')::uuid];
 ELSIF p_action='create_group' THEN
  kind:='group'; SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid) INTO children FROM jsonb_array_elements_text(p_payload->'p_children');
  SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid) INTO staff FROM jsonb_array_elements_text(p_payload->'p_staff');
 ELSIF p_action='update_group' THEN
  excluded:=(p_payload->>'p_activity')::uuid; kind:='group';
  SELECT * INTO g FROM rejoyce_security.group_activities WHERE id=excluded AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled activity unavailable' USING ERRCODE='42501'; END IF;
  SELECT array_agg(child_id ORDER BY child_id) INTO children FROM rejoyce_security.group_activity_children WHERE activity_id=excluded AND organization_id=org;
  SELECT array_agg(user_id ORDER BY user_id) INTO staff FROM rejoyce_security.group_activity_staff WHERE activity_id=excluded AND organization_id=org;
  skip:=p_payload->>'p_status'='canceled' OR (g.scheduled_start=(p_payload->>'p_start')::timestamptz AND g.scheduled_end=(p_payload->>'p_end')::timestamptz AND g.status=p_payload->>'p_status');
 ELSIF p_action='update_session' THEN
  excluded:=(p_payload->>'p_session')::uuid;
  SELECT * INTO s FROM public.sessions WHERE id=excluded AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled record unavailable' USING ERRCODE='42501'; END IF;
  PERFORM rejoyce_security.require_visible_session(excluded);
  IF jsonb_typeof(p_payload->'p_changes') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid schedule changes' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_payload->'p_changes') LOOP
   IF k NOT IN ('provider_id','session_type','scheduled_start','scheduled_end','location','status','attendance_status','was_supervised') THEN RAISE EXCEPTION 'Unsupported schedule field' USING ERRCODE='22023'; END IF;
  END LOOP;
  next_s:=jsonb_populate_record(s,p_payload->'p_changes'); kind:=s.workflow_intent; children:=ARRAY[s.client_id]; staff:=ARRAY[next_s.provider_id];
  from_at:=next_s.scheduled_start; to_at:=next_s.scheduled_end;
  skip:=next_s.status IN ('canceled','client_absent','provider_absent','no_show') OR
   (s.scheduled_start IS NOT DISTINCT FROM from_at AND s.scheduled_end IS NOT DISTINCT FROM to_at AND s.provider_id IS NOT DISTINCT FROM next_s.provider_id AND s.status=next_s.status);
 ELSE RAISE EXCEPTION 'Unknown scheduling action' USING ERRCODE='22023'; END IF;
 IF p_action<>'update_session' THEN from_at:=(p_payload->>'p_start')::timestamptz;to_at:=(p_payload->>'p_end')::timestamptz; END IF;
 IF kind IS NULL OR kind NOT IN ('clinical','activity','group') OR children IS NULL OR staff IS NULL OR cardinality(children) NOT BETWEEN 1 AND 200 OR cardinality(staff) NOT BETWEEN 1 AND 30 OR array_position(children,NULL) IS NOT NULL OR array_position(staff,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose valid children and assigned staff' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(children) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=requested.id AND c.organization_id=org)) OR
 EXISTS(SELECT 1 FROM unnest(staff) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=requested.id AND u.organization_id=org)) THEN RAISE EXCEPTION 'Scheduling participants unavailable' USING ERRCODE='42501'; END IF;
 IF NOT coalesce(skip,false) AND (from_at IS NULL OR to_at IS NULL OR NOT isfinite(from_at) OR NOT isfinite(to_at) OR to_at<=from_at OR to_at-from_at>interval '24 hours') THEN RAISE EXCEPTION 'Choose valid start and end times within 24 hours' USING ERRCODE='22023'; END IF;
 IF kind='clinical' THEN PERFORM rejoyce_security.require_clinical_client(children[1]); END IF;
 RETURN jsonb_build_object('organization',org,'children',children,'staff',staff,'start',from_at,'end',to_at,'exclude',excluded,'kind',kind,'skip',coalesce(skip,false));
END $body$);
 f:='rejoyce_security.onboarding_progress(boolean)'::regprocedure;
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'31cebc3bd44dc22116e0161f5debdc04' THEN RAISE EXCEPTION 'Clinical predecessor changed: rejoyce_security.onboarding_progress'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),$body$
DECLARE org uuid; result jsonb; staff_summary jsonb;
BEGIN
  PERFORM rejoyce_security.require_unlocked();
  org := public.current_organization_id();
  IF auth.uid() IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'An active organization account is required' USING ERRCODE='42501';
  END IF;
  IF p_include_staff AND NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'User management permission required' USING ERRCODE='42501';
  END IF;
  WITH staff AS (
    SELECT u.id,u.status,u.role, (u.pin_hash IS NOT NULL AND NOT coalesce(u.pin_reset_required,true)) pin_ready,
      CASE WHEN a.email_confirmed_at IS NOT NULL THEN 'accepted'
        WHEN a.invited_at IS NOT NULL THEN 'pending' ELSE 'unknown' END invitation,
      (a.email_confirmed_at IS NOT NULL AND u.pin_hash IS NOT NULL AND coalesce(u.pin_reset_required,true)=false
        AND (a.banned_until IS NULL OR a.banned_until <= now())) account_ready,
      u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff') frontline,
      EXISTS(SELECT 1 FROM public.staff_locations sl JOIN public.organization_locations l
        ON l.id=sl.location_id AND l.organization_id=sl.organization_id
        WHERE sl.user_id=u.id AND sl.organization_id=org AND l.active) branch_assigned,
      EXISTS(SELECT 1 FROM public.client_care_members m JOIN public.clients c
        ON c.id=m.client_id AND c.organization_id=m.organization_id
        JOIN public.client_locations cl ON cl.client_id=c.id AND cl.organization_id=c.organization_id
        JOIN public.staff_locations sl ON sl.user_id=m.user_id AND sl.location_id=cl.location_id AND sl.organization_id=org
        JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=org
        WHERE m.user_id=u.id AND m.organization_id=org AND c.status='active' AND l.active) care_assigned
    FROM public.users u LEFT JOIN auth.users a ON a.id=u.id WHERE u.organization_id=org
  )
  SELECT jsonb_build_object(
    'staff_ready',EXISTS(SELECT 1 FROM staff WHERE frontline AND status='active' AND account_ready),
    'staff',CASE WHEN p_include_staff THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'invitation',invitation,'account_ready',account_ready,'status',status,'pin_ready',pin_ready,
      'ready',frontline AND status='active' AND account_ready,
      'frontline',frontline,'branch_assigned',branch_assigned,'care_assigned',care_assigned
    ) ORDER BY id) FROM staff),'[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO staff_summary;
  result := jsonb_build_object(
    'branch',EXISTS(SELECT 1 FROM public.organization_locations WHERE organization_id=org AND active),
    'session_type',EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND active),
    'client',EXISTS(SELECT 1 FROM public.clients WHERE organization_id=org AND status='active'),
    'staff_ready',staff_summary->'staff_ready',
    'scheduled',EXISTS(SELECT 1 FROM public.sessions WHERE organization_id=org AND scheduled_start IS NOT NULL AND status <> 'canceled' AND (workflow_intent='activity' OR rejoyce_security.clinical_program_allowed(organization_id,client_id,false))),
    'can_write',(public.subscription_access()->>'canWrite')::boolean,
    'can_clients',public.can_manage_clients(),'can_users',public.can_manage_users(),'can_sessions',public.can_manage_sessions(),
    'staff',staff_summary->'staff'
  );
  -- Care is an optional shortcut; report it even when individual staff are hidden.
  RETURN result || jsonb_build_object('care',EXISTS(
    SELECT 1 FROM public.client_care_members m JOIN public.clients c ON c.id=m.client_id AND c.organization_id=m.organization_id
    JOIN public.users u ON u.id=m.user_id AND u.organization_id=m.organization_id
    JOIN public.client_locations cl ON cl.client_id=c.id AND cl.organization_id=org
    JOIN public.staff_locations sl ON sl.user_id=u.id AND sl.location_id=cl.location_id AND sl.organization_id=org
    JOIN public.organization_locations l ON l.id=cl.location_id AND l.organization_id=org
    WHERE m.organization_id=org AND c.status='active' AND u.status='active' AND l.active
      AND u.role IN ('therapist','teacher','educator','assistant','aide','caregiver','staff')));
END;
$body$);
END $patch$;
DO $patch$ DECLARE body text; definition text; f regprocedure:='rejoyce_security.effective_capabilities()'::regprocedure; BEGIN
 SELECT replace(prosrc,chr(13),'') INTO body FROM pg_proc WHERE oid=f;
 IF md5(body)<>'e6e1875ee47abae0718d24d831b848fe' THEN RAISE EXCEPTION 'Clinical predecessor changed: effective_capabilities'; END IF;
 definition:=pg_get_functiondef(f);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),replace(body,'''clients'',public.can_manage_clients()','''clinical'',rejoyce_security.clinical_actor_allowed(org),''clients'',public.can_manage_clients()'));
END $patch$;
-- Organization-level clinical vocabulary is distinct from shared Activity types.
CREATE FUNCTION rejoyce_security.clinical_catalog_allowed(p_org uuid,p_edit boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT rejoyce_security.clinical_actor_allowed(p_org) AND (NOT p_edit OR
 (public.can_manage_clients() AND rejoyce_security.organization_can_write(p_org) AND EXISTS(
 SELECT 1 FROM rejoyce_security.clinical_program_grants WHERE organization_id=p_org AND user_id=auth.uid() AND program_edit)))
$$;
CREATE POLICY clinical_catalog_read ON public.target_categories AS RESTRICTIVE FOR SELECT TO authenticated USING(rejoyce_security.clinical_catalog_allowed(organization_id,false));
CREATE POLICY clinical_catalog_insert ON public.target_categories AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(rejoyce_security.clinical_catalog_allowed(organization_id,true));
CREATE POLICY clinical_catalog_update ON public.target_categories AS RESTRICTIVE FOR UPDATE TO authenticated USING(rejoyce_security.clinical_catalog_allowed(organization_id,true)) WITH CHECK(rejoyce_security.clinical_catalog_allowed(organization_id,true));
CREATE POLICY clinical_catalog_delete ON public.target_categories AS RESTRICTIVE FOR DELETE TO authenticated USING(rejoyce_security.clinical_catalog_allowed(organization_id,true));
CREATE FUNCTION rejoyce_security.guard_clinical_catalog() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 IF auth.uid() IS NOT NULL OR current_setting('role',true) IN ('authenticated','anon') THEN
  org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT rejoyce_security.clinical_catalog_allowed(org,true) THEN RAISE EXCEPTION 'Clinical catalog unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER clinical_access BEFORE INSERT OR UPDATE OR DELETE ON public.target_categories FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_clinical_catalog();
REVOKE ALL ON FUNCTION rejoyce_security.clinical_catalog_allowed(uuid,boolean),rejoyce_security.guard_clinical_catalog() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rejoyce_security.clinical_catalog_allowed(uuid,boolean) TO authenticated;

COMMIT;
