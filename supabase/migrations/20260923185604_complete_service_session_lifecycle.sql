-- Note writes are serialized with their parent session. Version checks prevent stale-tab writes.
ALTER TABLE public.session_notes ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE public.session_notes ADD COLUMN locked_from_status text CHECK (locked_from_status IN ('submitted','approved'));
ALTER TABLE public.session_notes ADD COLUMN locked_at timestamptz;
-- This metadata backfill must not rewrite the existing note's own timestamp.
ALTER TABLE public.session_notes DISABLE TRIGGER set_session_notes_updated_at;
UPDATE public.session_notes SET locked_from_status='approved', locked_at=updated_at WHERE status='locked';
ALTER TABLE public.session_notes ENABLE TRIGGER set_session_notes_updated_at;

CREATE TABLE public.session_note_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  session_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES public.session_notes(id),
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid NOT NULL UNIQUE,
  request_payload jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  FOREIGN KEY(session_id,organization_id) REFERENCES public.sessions(id,organization_id)
);
CREATE INDEX session_note_history_session_time ON public.session_note_history(session_id,occurred_at DESC,id);
CREATE INDEX session_note_history_organization ON public.session_note_history(organization_id);
CREATE INDEX session_note_history_note ON public.session_note_history(note_id);
CREATE TABLE public.session_note_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  session_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES public.session_notes(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(session_id,organization_id) REFERENCES public.sessions(id,organization_id)
);
CREATE INDEX session_note_remarks_session_time ON public.session_note_remarks(session_id,created_at,id);
CREATE INDEX session_note_remarks_organization ON public.session_note_remarks(organization_id);
CREATE INDEX session_note_remarks_note ON public.session_note_remarks(note_id);
ALTER TABLE public.session_note_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_note_remarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_note_history,public.session_note_remarks FROM anon,authenticated;
GRANT SELECT ON public.session_note_history,public.session_note_remarks TO authenticated;

CREATE FUNCTION rejoyce_security.is_note_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT rejoyce_security.session_is_unlocked() AND EXISTS (
   SELECT 1 FROM public.users WHERE id=auth.uid() AND status='active' AND role IN ('owner','admin')
 );
$$;
REVOKE ALL ON FUNCTION rejoyce_security.is_note_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.is_note_admin() TO authenticated;

CREATE POLICY note_admin_read ON public.session_notes FOR SELECT TO authenticated
USING (organization_id=(select public.current_organization_id()) AND (select rejoyce_security.is_note_admin()));
CREATE POLICY note_admin_session_read ON public.sessions FOR SELECT TO authenticated
USING (organization_id=(select public.current_organization_id()) AND (select rejoyce_security.is_note_admin()));
CREATE POLICY reviewer_target_read ON public.session_targets FOR SELECT TO authenticated
USING (organization_id=(select public.current_organization_id()) AND (select public.can_review_sessions()));
CREATE POLICY history_read ON public.session_note_history FOR SELECT TO authenticated
USING (organization_id=(select public.current_organization_id()) AND
 ((select public.can_review_sessions()) OR (select rejoyce_security.is_note_admin()) OR public.is_assigned_session_provider(session_id)));
CREATE POLICY history_device ON public.session_note_history AS RESTRICTIVE FOR ALL TO authenticated
USING ((select rejoyce_security.session_is_unlocked())) WITH CHECK ((select rejoyce_security.session_is_unlocked()));
CREATE POLICY remarks_read ON public.session_note_remarks FOR SELECT TO authenticated
USING (organization_id=(select public.current_organization_id()) AND
 ((select public.can_review_sessions()) OR (select rejoyce_security.is_note_admin()) OR public.is_assigned_session_provider(session_id)));
CREATE POLICY remarks_device ON public.session_note_remarks AS RESTRICTIVE FOR ALL TO authenticated
USING ((select rejoyce_security.session_is_unlocked())) WITH CHECK ((select rejoyce_security.session_is_unlocked()));

-- Existing records receive a baseline, not invented historical events.
INSERT INTO public.session_note_history(organization_id,session_id,note_id,actor_name,action,operation_id,request_payload,snapshot)
SELECT organization_id,session_id,id,'System','baseline',gen_random_uuid(),'{}',to_jsonb(n) FROM public.session_notes n;

CREATE FUNCTION rejoyce_security.mutate_session_note(
 p_session_id uuid,p_action text,p_version integer,p_operation_id uuid,
 p_final_note text,p_addendum text,p_feedback text
) RETURNS public.session_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION rejoyce_security.mutate_session_note(uuid,text,integer,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.mutate_session_note(uuid,text,integer,uuid,text,text,text) TO authenticated;
CREATE FUNCTION public.mutate_session_note(p_session_id uuid,p_action text,p_version integer,p_operation_id uuid,p_final_note text DEFAULT NULL,p_addendum text DEFAULT NULL,p_feedback text DEFAULT NULL)
RETURNS public.session_notes LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT rejoyce_security.mutate_session_note(p_session_id,p_action,p_version,p_operation_id,p_final_note,p_addendum,p_feedback);
$$;
REVOKE ALL ON FUNCTION public.mutate_session_note(uuid,text,integer,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_session_note(uuid,text,integer,uuid,text,text,text) TO authenticated;

CREATE FUNCTION rejoyce_security.append_session_note_remark(p_session_id uuid,p_body text,p_operation_id uuid)
RETURNS public.session_note_remarks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION rejoyce_security.append_session_note_remark(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.append_session_note_remark(uuid,text,uuid) TO authenticated;
CREATE FUNCTION public.append_session_note_remark(p_session_id uuid,p_body text,p_operation_id uuid)
RETURNS public.session_note_remarks LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT rejoyce_security.append_session_note_remark(p_session_id,p_body,p_operation_id);
$$;
REVOKE ALL ON FUNCTION public.append_session_note_remark(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.append_session_note_remark(uuid,text,uuid) TO authenticated;

-- These invoker triggers distinguish direct Data API writes from authorized definer RPCs.
CREATE FUNCTION rejoyce_security.guard_service_session() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
CREATE TRIGGER guard_service_session BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_service_session();
REVOKE ALL ON FUNCTION rejoyce_security.guard_service_session() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.guard_session_target() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
CREATE TRIGGER guard_session_target BEFORE INSERT OR UPDATE OR DELETE ON public.session_targets FOR EACH ROW EXECUTE FUNCTION rejoyce_security.guard_session_target();
REVOKE ALL ON FUNCTION rejoyce_security.guard_session_target() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.swap_session_targets(p_session_id uuid,p_first uuid,p_second uuid,p_first_order integer,p_second_order integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION rejoyce_security.swap_session_targets(uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.swap_session_targets(uuid,uuid,uuid,integer,integer) TO authenticated;
CREATE FUNCTION public.swap_session_targets(p_session_id uuid,p_first uuid,p_second uuid,p_first_order integer,p_second_order integer)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT rejoyce_security.swap_session_targets(p_session_id,p_first,p_second,p_first_order,p_second_order);
$$;
REVOKE ALL ON FUNCTION public.swap_session_targets(uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.swap_session_targets(uuid,uuid,uuid,integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.save_assigned_session_note_draft(requested_session_id uuid, requested_therapist_addendum text, requested_final_note text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_assigned_session_note(requested_session_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_session_note_for_review(p_note_id uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.return_session_note_for_correction(p_note_id uuid, p_review_notes text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.approve_session_note(p_note_id uuid, p_review_notes text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.lock_session_note(p_note_id uuid) FROM PUBLIC, anon, authenticated;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;
