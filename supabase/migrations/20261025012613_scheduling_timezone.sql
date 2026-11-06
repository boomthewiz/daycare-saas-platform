BEGIN;
-- Separate from reporting settings; no inference, backfill or timestamp rewrite.
CREATE TABLE rejoyce_security.scheduling_timezone_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id), timezone text NOT NULL,
 version integer NOT NULL CHECK(version>0), updated_by uuid NOT NULL REFERENCES public.users(id), updated_at timestamptz NOT NULL
);
CREATE TABLE rejoyce_security.scheduling_timezone_history (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), version integer NOT NULL,
 previous_timezone text, timezone text NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,version)
);
ALTER TABLE rejoyce_security.scheduling_timezone_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.scheduling_timezone_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.scheduling_timezone_settings,rejoyce_security.scheduling_timezone_history FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.scheduling_timezone() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; s rejoyce_security.scheduling_timezone_settings%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL THEN RAISE EXCEPTION 'Active organization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM rejoyce_security.scheduling_timezone_settings WHERE organization_id=org;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'timezone',s.timezone,'version',coalesce(s.version,0),
 'canManage',public.can_manage_users() AND public.current_user_role() IN ('owner','admin'),
 'canWrite',rejoyce_security.organization_can_write(org),'updatedBy',s.updated_by,'updatedAt',s.updated_at);
END $$;
CREATE FUNCTION public.scheduling_timezone() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.scheduling_timezone() $$;
CREATE FUNCTION rejoyce_security.set_scheduling_timezone(p_organization uuid,p_timezone text,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; s rejoyce_security.scheduling_timezone_settings%rowtype; stamp timestamptz:=clock_timestamp();
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR p_organization IS DISTINCT FROM org OR NOT public.can_manage_users() OR public.current_user_role() NOT IN ('owner','admin') OR NOT rejoyce_security.organization_can_write(org) THEN
 RAISE EXCEPTION 'Account configuration and editing access required' USING ERRCODE='42501'; END IF;
 IF p_timezone IS NULL OR length(p_timezone)>100 OR (p_timezone<>'UTC' AND position('/' IN p_timezone)=0) OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) OR p_timezone LIKE 'posix/%' OR p_timezone LIKE 'right/%' OR p_version IS NULL OR p_version<0 THEN
 RAISE EXCEPTION 'Choose a valid IANA timezone and current version' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO s FROM rejoyce_security.scheduling_timezone_settings WHERE organization_id=org;
 IF coalesce(s.version,0)<>p_version THEN RAISE EXCEPTION 'Scheduling timezone changed. Reload and review.' USING ERRCODE='40001'; END IF;
 INSERT INTO rejoyce_security.scheduling_timezone_settings VALUES(org,p_timezone,p_version+1,auth.uid(),stamp)
 ON CONFLICT(organization_id) DO UPDATE SET timezone=excluded.timezone,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 INSERT INTO rejoyce_security.scheduling_timezone_history VALUES(org,p_version+1,s.timezone,p_timezone,auth.uid(),stamp);
 RETURN rejoyce_security.scheduling_timezone();
END $$;
CREATE FUNCTION public.set_scheduling_timezone(p_organization uuid,p_timezone text,p_version integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.set_scheduling_timezone(p_organization,p_timezone,p_version) $$;

-- Exact roundtrip candidates. Never let AT TIME ZONE silently choose a repeated occurrence or normalize a gap.
CREATE FUNCTION rejoyce_security.scheduling_civil_candidates(p_local text,p_timezone text) RETURNS timestamptz[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE wall timestamp; options timestamptz[];
BEGIN
 IF p_local IS NULL OR p_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$' THEN RAISE EXCEPTION 'Invalid civil time' USING ERRCODE='22023'; END IF;
 wall:=p_local::timestamp;
 SELECT coalesce(array_agg(candidate ORDER BY candidate),'{}'::timestamptz[]) INTO options FROM (
  SELECT DISTINCT (wall AT TIME ZONE 'UTC')-((sample AT TIME ZONE p_timezone)-(sample AT TIME ZONE 'UTC')) candidate
  FROM generate_series((wall AT TIME ZONE 'UTC')-interval '48 hours',(wall AT TIME ZONE 'UTC')+interval '48 hours',interval '6 hours') sample
 ) x WHERE candidate AT TIME ZONE p_timezone=wall;
 RETURN options;
END $$;
-- Shared private boundary contract for item 7. No device date and no fixed 24-hour duration.
CREATE FUNCTION rejoyce_security.scheduling_day_bounds(p_organization uuid,p_instant timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE zone text; day date; floor_at timestamptz; ceiling_at timestamptz;
BEGIN
 PERFORM rejoyce_security.require_unlocked();
 IF auth.uid() IS NULL OR p_organization IS DISTINCT FROM public.current_organization_id() OR p_instant IS NULL OR NOT isfinite(p_instant) THEN RAISE EXCEPTION 'Active organization and instant required' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO zone FROM rejoyce_security.scheduling_timezone_settings WHERE organization_id=p_organization;
 IF zone IS NULL THEN RAISE EXCEPTION 'Confirm organization scheduling timezone first' USING ERRCODE='22023'; END IF;
 day:=(p_instant AT TIME ZONE zone)::date;
 floor_at:=coalesce((rejoyce_security.scheduling_civil_candidates(day::text||'T00:00',zone))[1],day::timestamp AT TIME ZONE zone);
 ceiling_at:=coalesce((rejoyce_security.scheduling_civil_candidates((day+1)::text||'T00:00',zone))[1],(day+1)::timestamp AT TIME ZONE zone);
 RETURN jsonb_build_object('date',day,'timezone',zone,'start',floor_at,'end',ceiling_at);
END $$;

ALTER FUNCTION rejoyce_security.conflict_proposal(text,jsonb) RENAME TO conflict_proposal_before_timezone;
CREATE FUNCTION rejoyce_security.conflict_proposal(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proposal jsonb; s rejoyce_security.scheduling_timezone_settings%rowtype; clock jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
 proposal:=rejoyce_security.conflict_proposal_before_timezone(p_action,p_payload);
 SELECT * INTO s FROM rejoyce_security.scheduling_timezone_settings WHERE organization_id=(proposal->>'organization')::uuid;
 clock:=p_payload->'p_clock';
 IF s.timezone IS NULL THEN RAISE EXCEPTION 'Confirm organization scheduling timezone first' USING ERRCODE='22023'; END IF;
 IF clock IS NULL OR clock->>'timezone' IS DISTINCT FROM s.timezone OR clock->>'version' IS DISTINCT FROM s.version::text THEN RAISE EXCEPTION 'Scheduling timezone changed or unverified. Reload and review times.' USING ERRCODE='40001'; END IF;
 -- Metadata-only changes retain exact saved instants, including unknown ends.
 IF p_action='update_session' AND NOT (p_payload->'p_changes' ?| ARRAY['scheduled_start','scheduled_end']) THEN RETURN proposal; END IF;
 start_at:=(proposal->>'start')::timestamptz;end_at:=(proposal->>'end')::timestamptz;
 IF start_at IS NULL OR end_at IS NULL OR NOT (start_at=ANY(rejoyce_security.scheduling_civil_candidates(clock->>'startLocal',s.timezone))) OR NOT (end_at=ANY(rejoyce_security.scheduling_civil_candidates(clock->>'endLocal',s.timezone))) THEN
 RAISE EXCEPTION 'Schedule times do not match the reviewed organization timezone or DST occurrence' USING ERRCODE='22023'; END IF;
 RETURN proposal;
END $$;
-- Revalidate even on connections which prepared the older implementation before this migration.
ALTER FUNCTION rejoyce_security.schedule_conflicts(text,jsonb) RENAME TO schedule_conflicts_before_timezone;
CREATE FUNCTION rejoyce_security.schedule_conflicts(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM rejoyce_security.conflict_proposal(p_action,p_payload);
 RETURN rejoyce_security.schedule_conflicts_before_timezone(p_action,p_payload);
END $$;
CREATE OR REPLACE FUNCTION public.schedule_conflicts(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.schedule_conflicts(p_action,p_payload) $$;
-- Acquire the same lock used by timezone settings before validation, including receipt retries.
ALTER FUNCTION rejoyce_security.save_reviewed_schedule(text,jsonb,uuid,jsonb) RENAME TO save_reviewed_schedule_before_timezone;
CREATE FUNCTION rejoyce_security.save_reviewed_schedule(p_action text,p_payload jsonb,p_review uuid,p_ack jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Scheduling management required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 PERFORM rejoyce_security.conflict_proposal(p_action,p_payload);
 RETURN rejoyce_security.save_reviewed_schedule_before_timezone(p_action,p_payload,p_review,p_ack);
END $$;
-- SQL wrappers are replaced to rebind them to the new implementations after the renames.
CREATE OR REPLACE FUNCTION public.save_reviewed_schedule(p_action text,p_payload jsonb,p_review uuid DEFAULT NULL,p_ack jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_reviewed_schedule(p_action,p_payload,p_review,p_ack) $$;
REVOKE ALL ON FUNCTION rejoyce_security.conflict_proposal_before_timezone(text,jsonb),rejoyce_security.conflict_proposal(text,jsonb),rejoyce_security.scheduling_civil_candidates(text,text),rejoyce_security.scheduling_day_bounds(uuid,timestamptz),rejoyce_security.save_reviewed_schedule_before_timezone(text,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION rejoyce_security.schedule_conflicts_before_timezone(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION rejoyce_security.schedule_conflicts(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.schedule_conflicts(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.scheduling_timezone(),rejoyce_security.scheduling_timezone(),public.set_scheduling_timezone(uuid,text,integer),rejoyce_security.set_scheduling_timezone(uuid,text,integer),rejoyce_security.save_reviewed_schedule(text,jsonb,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.scheduling_timezone(),rejoyce_security.scheduling_timezone(),public.set_scheduling_timezone(uuid,text,integer),rejoyce_security.set_scheduling_timezone(uuid,text,integer),rejoyce_security.save_reviewed_schedule(text,jsonb,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
