-- F02: database-enforced tenant and session/client integrity.
-- Preserve existing relationship names and delete actions for PostgREST clients.
-- All DDL and the self-cleaning verification below must run in one transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- These nullable legacy business columns otherwise bypass composite foreign keys.
-- Unaffiliated users and pending owner requests retain nullable membership.
ALTER TABLE public.behavior_events ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.children ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.classrooms ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.client_behaviors ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.client_targets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.clients ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.daily_tasks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.generated_tasks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.organization_locations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.organization_terminology ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.session_notes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.session_targets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.session_types ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.target_categories ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.target_responses ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.task_templates ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.user_permissions ALTER COLUMN organization_id SET NOT NULL;

-- Derive context for existing callers; FKs, not lookups alone, enforce integrity.
ALTER TABLE public.session_targets ADD COLUMN client_id uuid;
ALTER TABLE public.behavior_events ADD COLUMN client_id uuid;
ALTER TABLE public.task_completions ADD COLUMN organization_id uuid;

UPDATE public.session_targets st SET client_id=s.client_id FROM public.sessions s WHERE s.id=st.session_id;
UPDATE public.behavior_events e SET client_id=s.client_id FROM public.sessions s WHERE s.id=e.session_id;
UPDATE public.task_completions c SET organization_id=t.organization_id FROM public.tasks t WHERE t.id=c.task_id;
ALTER TABLE public.session_targets ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.behavior_events ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.task_completions ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE public.task_completions ALTER COLUMN organization_id SET NOT NULL;

CREATE OR REPLACE FUNCTION rejoyce_security.derive_session_client()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION rejoyce_security.derive_session_client() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER derive_session_client BEFORE INSERT OR UPDATE OF session_id,client_id
ON public.session_targets FOR EACH ROW EXECUTE FUNCTION rejoyce_security.derive_session_client();
CREATE TRIGGER derive_session_client BEFORE INSERT OR UPDATE OF session_id,client_id
ON public.behavior_events FOR EACH ROW EXECUTE FUNCTION rejoyce_security.derive_session_client();

CREATE OR REPLACE FUNCTION rejoyce_security.derive_task_organization()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT t.organization_id INTO NEW.organization_id FROM public.tasks t WHERE t.id=NEW.task_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION rejoyce_security.derive_task_organization() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER derive_task_organization BEFORE INSERT ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.derive_task_organization();

-- Changing established membership is not an ordinary record edit.
-- First membership assignment remains available to the existing trusted provisioning path.
CREATE OR REPLACE FUNCTION rejoyce_security.prevent_tenant_reassignment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND OLD.organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'An existing record cannot be moved between organizations'
      USING ERRCODE = '23514', CONSTRAINT = 'organization_id_immutable';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION rejoyce_security.prevent_tenant_reassignment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.behavior_events
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.children
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.classrooms
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.client_behaviors
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.client_targets
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.clients
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.daily_tasks
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.generated_tasks
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.organization_locations
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.organization_terminology
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.owner_requests
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.session_notes
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.session_targets
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.session_types
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.sessions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.target_categories
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.target_responses
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.task_templates
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.users
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();
CREATE TRIGGER prevent_tenant_reassignment BEFORE UPDATE OF organization_id ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION rejoyce_security.prevent_tenant_reassignment();

-- Referenced unique keys supply native FK locking and concurrent-write safety.
ALTER TABLE public.client_behaviors ADD CONSTRAINT client_behaviors_client_tenant_key UNIQUE (id, client_id, organization_id);
ALTER TABLE public.users ADD CONSTRAINT users_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_client_tenant_key UNIQUE (id, client_id, organization_id);
ALTER TABLE public.clients ADD CONSTRAINT clients_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.children ADD CONSTRAINT children_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.task_templates ADD CONSTRAINT task_templates_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.client_targets ADD CONSTRAINT client_targets_client_tenant_key UNIQUE (id, client_id, organization_id);
ALTER TABLE public.session_targets ADD CONSTRAINT session_targets_session_tenant_key UNIQUE (id, session_id, organization_id);
ALTER TABLE public.classrooms ADD CONSTRAINT classrooms_tenant_key UNIQUE (id, organization_id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_tenant_key UNIQUE (id, organization_id);

-- Replace rather than duplicate relationships, retaining API join hints.
ALTER TABLE public.behavior_events DROP CONSTRAINT behavior_events_client_behavior_id_fkey;
ALTER TABLE public.behavior_events ADD CONSTRAINT behavior_events_client_behavior_id_fkey
  FOREIGN KEY (client_behavior_id, client_id, organization_id) REFERENCES public.client_behaviors (id, client_id, organization_id)
  ON DELETE SET NULL (client_behavior_id);
ALTER TABLE public.behavior_events DROP CONSTRAINT behavior_events_provider_id_fkey;
ALTER TABLE public.behavior_events ADD CONSTRAINT behavior_events_provider_id_fkey
  FOREIGN KEY (provider_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (provider_id);
ALTER TABLE public.behavior_events DROP CONSTRAINT behavior_events_session_id_fkey;
ALTER TABLE public.behavior_events ADD CONSTRAINT behavior_events_session_id_fkey
  FOREIGN KEY (session_id, client_id, organization_id) REFERENCES public.sessions (id, client_id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.children DROP CONSTRAINT children_teacher_id_fkey;
ALTER TABLE public.children ADD CONSTRAINT children_teacher_id_fkey
  FOREIGN KEY (teacher_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.client_behaviors DROP CONSTRAINT client_behaviors_client_id_fkey;
ALTER TABLE public.client_behaviors ADD CONSTRAINT client_behaviors_client_id_fkey
  FOREIGN KEY (client_id, organization_id) REFERENCES public.clients (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.client_targets DROP CONSTRAINT client_targets_client_id_fkey;
ALTER TABLE public.client_targets ADD CONSTRAINT client_targets_client_id_fkey
  FOREIGN KEY (client_id, organization_id) REFERENCES public.clients (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.client_targets DROP CONSTRAINT client_targets_created_by_fkey;
ALTER TABLE public.client_targets ADD CONSTRAINT client_targets_created_by_fkey
  FOREIGN KEY (created_by, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (created_by);
ALTER TABLE public.clients DROP CONSTRAINT clients_assigned_provider_id_fkey;
ALTER TABLE public.clients ADD CONSTRAINT clients_assigned_provider_id_fkey
  FOREIGN KEY (assigned_provider_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (assigned_provider_id);
ALTER TABLE public.generated_tasks DROP CONSTRAINT daily_tasks_child_id_fkey;
ALTER TABLE public.generated_tasks ADD CONSTRAINT daily_tasks_child_id_fkey
  FOREIGN KEY (child_id, organization_id) REFERENCES public.children (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.generated_tasks DROP CONSTRAINT daily_tasks_teacher_id_fkey;
ALTER TABLE public.generated_tasks ADD CONSTRAINT daily_tasks_teacher_id_fkey
  FOREIGN KEY (teacher_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.generated_tasks DROP CONSTRAINT daily_tasks_template_id_fkey;
ALTER TABLE public.generated_tasks ADD CONSTRAINT daily_tasks_template_id_fkey
  FOREIGN KEY (template_id, organization_id) REFERENCES public.task_templates (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.session_notes DROP CONSTRAINT session_notes_author_id_fkey;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_author_id_fkey
  FOREIGN KEY (author_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (author_id);
ALTER TABLE public.session_notes DROP CONSTRAINT session_notes_reviewed_by_fkey;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_reviewed_by_fkey
  FOREIGN KEY (reviewed_by, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (reviewed_by);
ALTER TABLE public.session_notes DROP CONSTRAINT session_notes_session_id_fkey;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_session_id_fkey
  FOREIGN KEY (session_id, organization_id) REFERENCES public.sessions (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.session_targets DROP CONSTRAINT session_targets_client_target_id_fkey;
ALTER TABLE public.session_targets ADD CONSTRAINT session_targets_client_target_id_fkey
  FOREIGN KEY (client_target_id, client_id, organization_id) REFERENCES public.client_targets (id, client_id, organization_id)
  ON DELETE SET NULL (client_target_id);
ALTER TABLE public.session_targets DROP CONSTRAINT session_targets_session_id_fkey;
ALTER TABLE public.session_targets ADD CONSTRAINT session_targets_session_id_fkey
  FOREIGN KEY (session_id, client_id, organization_id) REFERENCES public.sessions (id, client_id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.sessions DROP CONSTRAINT sessions_client_id_fkey;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_client_id_fkey
  FOREIGN KEY (client_id, organization_id) REFERENCES public.clients (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.sessions DROP CONSTRAINT sessions_prepared_by_fkey;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_prepared_by_fkey
  FOREIGN KEY (prepared_by, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (prepared_by);
ALTER TABLE public.sessions DROP CONSTRAINT sessions_provider_id_fkey;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_provider_id_fkey
  FOREIGN KEY (provider_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (provider_id);
ALTER TABLE public.sessions DROP CONSTRAINT sessions_supervisor_id_fkey;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_supervisor_id_fkey
  FOREIGN KEY (supervisor_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (supervisor_id);
ALTER TABLE public.target_responses DROP CONSTRAINT target_responses_provider_id_fkey;
ALTER TABLE public.target_responses ADD CONSTRAINT target_responses_provider_id_fkey
  FOREIGN KEY (provider_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE SET NULL (provider_id);
ALTER TABLE public.target_responses DROP CONSTRAINT target_responses_session_id_fkey;
ALTER TABLE public.target_responses ADD CONSTRAINT target_responses_session_id_fkey
  FOREIGN KEY (session_id, organization_id) REFERENCES public.sessions (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.target_responses DROP CONSTRAINT target_responses_session_target_id_fkey;
ALTER TABLE public.target_responses ADD CONSTRAINT target_responses_session_target_id_fkey
  FOREIGN KEY (session_target_id, session_id, organization_id) REFERENCES public.session_targets (id, session_id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.task_templates DROP CONSTRAINT task_templates_child_id_fkey;
ALTER TABLE public.task_templates ADD CONSTRAINT task_templates_child_id_fkey
  FOREIGN KEY (child_id, organization_id) REFERENCES public.children (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.task_templates DROP CONSTRAINT task_templates_teacher_id_fkey;
ALTER TABLE public.task_templates ADD CONSTRAINT task_templates_teacher_id_fkey
  FOREIGN KEY (teacher_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_classroom;
ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_classroom
  FOREIGN KEY (classroom_id, organization_id) REFERENCES public.classrooms (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.tasks DROP CONSTRAINT fk_tasks_template;
ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_template
  FOREIGN KEY (template_id, organization_id) REFERENCES public.task_templates (id, organization_id)
  ON DELETE SET NULL (template_id);
ALTER TABLE public.tasks DROP CONSTRAINT tasks_child_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_child_id_fkey
  FOREIGN KEY (child_id, organization_id) REFERENCES public.children (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.tasks DROP CONSTRAINT tasks_teacher_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_teacher_id_fkey
  FOREIGN KEY (teacher_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.user_permissions DROP CONSTRAINT user_permissions_user_id_fkey;
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_fkey
  FOREIGN KEY (user_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.task_completions DROP CONSTRAINT task_completions_task_id_fkey;
ALTER TABLE public.task_completions ADD CONSTRAINT task_completions_task_id_fkey
  FOREIGN KEY (task_id, organization_id) REFERENCES public.tasks (id, organization_id)
  ON DELETE CASCADE;
ALTER TABLE public.task_completions DROP CONSTRAINT task_completions_teacher_id_fkey;
ALTER TABLE public.task_completions ADD CONSTRAINT task_completions_teacher_id_fkey
  FOREIGN KEY (teacher_id, organization_id) REFERENCES public.users (id, organization_id)
  ON DELETE NO ACTION;
ALTER TABLE public.task_templates ADD CONSTRAINT task_templates_classroom_id_fkey
  FOREIGN KEY (classroom_id, organization_id) REFERENCES public.classrooms (id, organization_id)
  ON DELETE NO ACTION;

ALTER TABLE public.owner_requests ADD CONSTRAINT owner_requests_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
-- No new public RPC, role grant, or permissive RLS policy is introduced.
-- Restrictive session gating and existing tenant/role policies remain in force.

-- Index all added FK column sets unless an existing leading-key index covers them.
DO $indexes$
DECLARE r record; index_name text;
BEGIN
  FOR r IN
    SELECT c.conrelid, c.conname, c.conkey,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ordinality)
       FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) AS columns
    FROM pg_constraint c
    WHERE c.contype='f' AND c.connamespace='public'::regnamespace AND cardinality(c.conkey)>1
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid=r.conrelid AND i.indisvalid
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (i.indkey::smallint[])[0:cardinality(r.conkey)-1] @> r.conkey
    ) THEN
      index_name := left(r.conname, 52) || '_tenant_idx';
      EXECUTE format('CREATE INDEX %I ON %s (%s)',index_name,r.conrelid::regclass,r.columns);
    END IF;
  END LOOP;
END;
$indexes$;

-- Self-cleaning integration tests. Run as the migration/database administrator.
-- No email is sent. All synthetic records and JWT settings roll back even on success.
DO $tenant_tests$
DECLARE
  ids jsonb := '{}'::jsonb;
  g jsonb;
  tenant text;
  org uuid;
  uid uuid;
  sid uuid;
  provider uuid;
  second_client uuid;
  second_session uuid;
  second_target uuid;
  second_behavior uuid;
  disposable_user uuid;
  row_id uuid;
  r record;
  c integer;
  affected integer;
  fk_count integer := 0;
  table_name text;
  actor text;
  own_session uuid;
  foreign_session uuid;
BEGIN
  BEGIN
    FOREACH tenant IN ARRAY ARRAY['a','b'] LOOP
      org := gen_random_uuid(); uid := gen_random_uuid(); sid := gen_random_uuid(); provider := gen_random_uuid();
      INSERT INTO public.organizations(id,name) VALUES(org,'Tenant integrity test '||tenant);
      INSERT INTO auth.users(id,email,raw_user_meta_data)
        VALUES(uid,uid::text||'@example.invalid','{}'),(provider,provider::text||'@example.invalid','{}');
      -- Auth-trigger-created profiles can still receive their first organization.
      UPDATE public.users SET organization_id=org,role='owner',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=uid;
      UPDATE public.users SET organization_id=org,role='teacher',status='active',pin_hash='synthetic',pin_reset_required=false WHERE id=provider;
      INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,uid,clock_timestamp());
      INSERT INTO public.device_sessions(session_id,user_id,full_auth_at,last_pin_at,unlocked_until)
        VALUES(sid,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes');
      g := jsonb_build_object('organization',org,'owner',uid,'auth_session',sid,'users',provider);
      INSERT INTO public.clients(organization_id,first_name,assigned_provider_id) VALUES(org,'Synthetic client',provider) RETURNING id INTO row_id;
      g := g || jsonb_build_object('clients',row_id);
      INSERT INTO public.children(organization_id,name,teacher_id) VALUES(org,'Synthetic child',provider) RETURNING id INTO row_id;
      g := g || jsonb_build_object('children',row_id);
      INSERT INTO public.classrooms(organization_id,name) VALUES(org,'Synthetic classroom') RETURNING id INTO row_id;
      g := g || jsonb_build_object('classrooms',row_id);
      INSERT INTO public.task_templates(organization_id,title,type,frequency,teacher_id,child_id,classroom_id)
        VALUES(org,'Synthetic template','child','daily',provider,(g->>'children')::uuid,(g->>'classrooms')::uuid) RETURNING id INTO row_id;
      g := g || jsonb_build_object('task_templates',row_id);
      INSERT INTO public.tasks(organization_id,title,teacher_id,child_id,classroom_id,template_id)
        VALUES(org,'Synthetic task',provider,(g->>'children')::uuid,(g->>'classrooms')::uuid,(g->>'task_templates')::uuid) RETURNING id INTO row_id;
      g := g || jsonb_build_object('tasks',row_id);
      INSERT INTO public.client_targets(organization_id,client_id,created_by,title)
        VALUES(org,(g->>'clients')::uuid,provider,'Synthetic target') RETURNING id INTO row_id;
      g := g || jsonb_build_object('client_targets',row_id);
      INSERT INTO public.client_behaviors(organization_id,client_id,name)
        VALUES(org,(g->>'clients')::uuid,'Synthetic behavior') RETURNING id INTO row_id;
      g := g || jsonb_build_object('client_behaviors',row_id);
      INSERT INTO public.sessions(organization_id,client_id,provider_id,supervisor_id,prepared_by)
        VALUES(org,(g->>'clients')::uuid,provider,provider,provider) RETURNING id INTO row_id;
      g := g || jsonb_build_object('sessions',row_id);
      INSERT INTO public.session_targets(organization_id,session_id,client_target_id,title)
        VALUES(org,(g->>'sessions')::uuid,(g->>'client_targets')::uuid,'Synthetic session target') RETURNING id INTO row_id;
      g := g || jsonb_build_object('session_targets',row_id);
      INSERT INTO public.organization_locations(organization_id,name) VALUES(org,'Synthetic location');
      INSERT INTO public.organization_terminology(organization_id) VALUES(org);
      INSERT INTO public.session_types(organization_id,name,code) VALUES(org,'Synthetic type','tenant_test');
      INSERT INTO public.target_categories(organization_id,name) VALUES(org,'Synthetic category');
      INSERT INTO public.daily_tasks(organization_id) VALUES(org);
      INSERT INTO public.owner_requests(organization_id,full_name,organization_name,email)
        VALUES(org,'Synthetic owner','Synthetic organization',uid::text||'@example.invalid');
      IF tenant='a' THEN
        INSERT INTO public.generated_tasks(organization_id,title,template_id,teacher_id,child_id)
          VALUES(org,'Synthetic generated task',(g->>'task_templates')::uuid,provider,(g->>'children')::uuid) RETURNING id INTO row_id;
        g := g || jsonb_build_object('generated_tasks',row_id);
        INSERT INTO public.session_notes(organization_id,session_id,author_id,reviewed_by)
          VALUES(org,(g->>'sessions')::uuid,provider,provider) RETURNING id INTO row_id;
        g := g || jsonb_build_object('session_notes',row_id);
        INSERT INTO public.behavior_events(organization_id,session_id,client_behavior_id,provider_id,behavior_name)
          VALUES(org,(g->>'sessions')::uuid,(g->>'client_behaviors')::uuid,provider,'Synthetic behavior') RETURNING id INTO row_id;
        g := g || jsonb_build_object('behavior_events',row_id);
        INSERT INTO public.target_responses(organization_id,session_id,session_target_id,provider_id,result)
          VALUES(org,(g->>'sessions')::uuid,(g->>'session_targets')::uuid,provider,'independent') RETURNING id INTO row_id;
        g := g || jsonb_build_object('target_responses',row_id);
        INSERT INTO public.user_permissions(organization_id,user_id) VALUES(org,provider) RETURNING id INTO row_id;
        g := g || jsonb_build_object('user_permissions',row_id);
        -- Existing callers do not have to supply the new derived organization column.
        INSERT INTO public.task_completions(task_id,teacher_id)
          VALUES((g->>'tasks')::uuid,provider) RETURNING id INTO row_id;
        g := g || jsonb_build_object('task_completions',row_id);
      END IF;
      ids := ids || jsonb_build_object(tenant,g);
    END LOOP;
    g := ids->'a'; org := (g->>'organization')::uuid;
    own_session := (g->>'sessions')::uuid;
    foreign_session := (ids#>>'{b,sessions}')::uuid;

    -- Every hardened relationship must reject a foreign parent even for a privileged writer.
    FOR r IN SELECT * FROM (VALUES
      ('behavior_events','client_behavior_id','client_behaviors','behavior_events_client_behavior_id_fkey'),
      ('behavior_events','provider_id','users','behavior_events_provider_id_fkey'),
      ('behavior_events','session_id','sessions','behavior_events_session_id_fkey'),
      ('children','teacher_id','users','children_teacher_id_fkey'),
      ('client_behaviors','client_id','clients','client_behaviors_client_id_fkey'),
      ('client_targets','client_id','clients','client_targets_client_id_fkey'),
      ('client_targets','created_by','users','client_targets_created_by_fkey'),
      ('clients','assigned_provider_id','users','clients_assigned_provider_id_fkey'),
      ('generated_tasks','child_id','children','daily_tasks_child_id_fkey'),
      ('generated_tasks','teacher_id','users','daily_tasks_teacher_id_fkey'),
      ('generated_tasks','template_id','task_templates','daily_tasks_template_id_fkey'),
      ('session_notes','author_id','users','session_notes_author_id_fkey'),
      ('session_notes','reviewed_by','users','session_notes_reviewed_by_fkey'),
      ('session_notes','session_id','sessions','session_notes_session_id_fkey'),
      ('session_targets','client_target_id','client_targets','session_targets_client_target_id_fkey'),
      ('session_targets','session_id','sessions','session_targets_session_id_fkey'),
      ('sessions','client_id','clients','sessions_client_id_fkey'),
      ('sessions','prepared_by','users','sessions_prepared_by_fkey'),
      ('sessions','provider_id','users','sessions_provider_id_fkey'),
      ('sessions','supervisor_id','users','sessions_supervisor_id_fkey'),
      ('target_responses','provider_id','users','target_responses_provider_id_fkey'),
      ('target_responses','session_id','sessions','target_responses_session_id_fkey'),
      ('target_responses','session_target_id','session_targets','target_responses_session_target_id_fkey'),
      ('task_templates','child_id','children','task_templates_child_id_fkey'),
      ('task_templates','teacher_id','users','task_templates_teacher_id_fkey'),
      ('tasks','classroom_id','classrooms','fk_tasks_classroom'),
      ('tasks','template_id','task_templates','fk_tasks_template'),
      ('tasks','child_id','children','tasks_child_id_fkey'),
      ('tasks','teacher_id','users','tasks_teacher_id_fkey'),
      ('user_permissions','user_id','users','user_permissions_user_id_fkey'),
      ('task_completions','task_id','tasks','task_completions_task_id_fkey'),
      ('task_completions','teacher_id','users','task_completions_teacher_id_fkey'),
      ('task_templates','classroom_id','classrooms','task_templates_classroom_id_fkey')
    ) AS cases(child,col,parent,conname) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=('public.'||r.child)::regclass
        AND pc.conname=r.conname AND pc.contype='f' AND pc.convalidated AND cardinality(pc.conkey)>=2
      ) THEN RAISE EXCEPTION 'Tenant FK missing or unvalidated: %',r.conname; END IF;
      BEGIN
        EXECUTE format('UPDATE public.%I SET %I=$1 WHERE id=$2',r.child,r.col)
          USING (ids->'b'->>r.parent)::uuid,(g->>r.child)::uuid;
        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE EXCEPTION 'Foreign relationship accepted: % (% rows)',r.conname,affected;
      EXCEPTION WHEN foreign_key_violation THEN
        fk_count := fk_count+1;
      END;
    END LOOP;
    IF fk_count<>33 THEN RAISE EXCEPTION 'Incomplete relationship test matrix'; END IF;

    -- Tenant reassignment and null tenant bypasses must fail, including service-side writes.
    FOREACH table_name IN ARRAY ARRAY['behavior_events','children','classrooms','client_behaviors','client_targets','clients','daily_tasks','generated_tasks','organization_locations','organization_terminology','owner_requests','session_notes','session_targets','session_types','sessions','target_categories','target_responses','task_templates','tasks','user_permissions','users','task_completions'] LOOP
      BEGIN
        EXECUTE format('UPDATE public.%I SET organization_id=$1 WHERE organization_id=$2',table_name)
          USING (ids#>>'{b,organization}')::uuid,org;
        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE EXCEPTION 'Organization reassignment accepted: % (% rows)',table_name,affected;
      EXCEPTION WHEN check_violation THEN NULL; END;
    END LOOP;
    BEGIN
      UPDATE public.sessions SET organization_id=NULL WHERE id=own_session;
      RAISE EXCEPTION 'Null tenant bypass accepted';
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.sessions(organization_id,client_id) VALUES(NULL,(g->>'clients')::uuid);
      RAISE EXCEPTION 'Null tenant insert accepted';
    EXCEPTION WHEN not_null_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.task_completions(teacher_id) VALUES((g->>'users')::uuid);
      RAISE EXCEPTION 'Orphan task completion accepted';
    EXCEPTION WHEN not_null_violation THEN NULL; END;

    -- Same-organization data must also have the correct client/session context.
    INSERT INTO public.clients(organization_id,first_name) VALUES(org,'Second synthetic client') RETURNING id INTO second_client;
    INSERT INTO public.sessions(organization_id,client_id) VALUES(org,second_client) RETURNING id INTO second_session;
    INSERT INTO public.client_targets(organization_id,client_id,title) VALUES(org,second_client,'Second target') RETURNING id INTO second_target;
    INSERT INTO public.client_behaviors(organization_id,client_id,name) VALUES(org,second_client,'Second behavior') RETURNING id INTO second_behavior;
    BEGIN
      UPDATE public.session_targets SET client_target_id=second_target WHERE id=(g->>'session_targets')::uuid;
      RAISE EXCEPTION 'Wrong-client target accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.behavior_events SET client_behavior_id=second_behavior WHERE id=(g->>'behavior_events')::uuid;
      RAISE EXCEPTION 'Wrong-client behavior accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.target_responses SET session_id=second_session WHERE id=(g->>'target_responses')::uuid;
      RAISE EXCEPTION 'Wrong-session response accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.session_targets SET client_id=second_client WHERE id=(g->>'session_targets')::uuid;
      RAISE EXCEPTION 'Forged derived client accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.sessions SET client_id=second_client WHERE id=own_session;
      RAISE EXCEPTION 'Parent client reassignment corrupted existing records';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.client_targets SET client_id=second_client WHERE id=(g->>'client_targets')::uuid;
      RAISE EXCEPTION 'Source target reassignment corrupted session context';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      UPDATE public.session_targets SET session_id=second_session,client_target_id=NULL WHERE id=(g->>'session_targets')::uuid;
      RAISE EXCEPTION 'Moving a target orphaned its responses';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    -- Exercise the real authenticated role, RLS, unlocked-device gate, and definer RPC.
    PERFORM set_config('request.jwt.claim.sub',g->>'owner',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',g->>'owner','session_id',g->>'auth_session','role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    IF public.current_organization_id() IS DISTINCT FROM org THEN RAISE EXCEPTION 'Owner fixture not authenticated'; END IF;
    SELECT count(id) INTO c FROM public.sessions WHERE id=own_session;
    IF c<>1 THEN RAISE EXCEPTION 'Valid owner session read failed'; END IF;
    FOREACH table_name IN ARRAY ARRAY['behavior_events','children','classrooms','client_behaviors','client_targets','clients','daily_tasks','generated_tasks','organization_locations','organization_terminology','owner_requests','session_notes','session_targets','session_types','sessions','target_categories','target_responses','task_templates','tasks','user_permissions','users','task_completions'] LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id=$1',table_name)
          INTO c USING (ids#>>'{b,organization}')::uuid;
        IF c<>0 THEN RAISE EXCEPTION 'Foreign tenant read leaked: %',table_name; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
    BEGIN
      INSERT INTO public.sessions(organization_id,client_id)
        VALUES(org,(ids#>>'{b,clients}')::uuid);
      RAISE EXCEPTION 'Original F02 owner insert exploit still works';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    UPDATE public.sessions SET internal_notes='must not write' WHERE id=foreign_session;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Foreign tenant update permitted'; END IF;
    DELETE FROM public.tasks WHERE id=(ids#>>'{b,tasks}')::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Foreign tenant delete permitted'; END IF;
    PERFORM public.prepare_session_targets(own_session);
    BEGIN
      PERFORM public.prepare_session_targets(foreign_session);
      RAISE EXCEPTION USING ERRCODE='ZX002',MESSAGE='Cross-tenant definer RPC permitted';
    EXCEPTION WHEN SQLSTATE 'P0001' OR insufficient_privilege THEN NULL; END;
    -- Valid legacy inserts still derive context under caller RLS.
    INSERT INTO public.session_targets(organization_id,session_id,title) VALUES(org,own_session,'Ad hoc synthetic target');
    INSERT INTO public.task_completions(task_id,teacher_id) VALUES((g->>'tasks')::uuid,(g->>'users')::uuid);
    RESET ROLE;

    -- Anonymous and locked callers cannot use the new trigger functions as RPCs.
    IF EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.pronamespace='rejoyce_security'::regnamespace
      AND p.proname IN ('derive_session_client','derive_task_organization','prevent_tenant_reassignment')
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
    ) THEN RAISE EXCEPTION 'Private trigger function is executable by a browser role'; END IF;

    -- Optional references clear only their own ID, never the organization/client.
    disposable_user := gen_random_uuid();
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(disposable_user,disposable_user::text||'@example.invalid','{}');
    UPDATE public.users SET organization_id=org WHERE id=disposable_user;
    UPDATE public.sessions SET provider_id=disposable_user,supervisor_id=disposable_user,prepared_by=disposable_user WHERE id=own_session;
    UPDATE public.clients SET assigned_provider_id=disposable_user WHERE id=(g->>'clients')::uuid;
    UPDATE public.client_targets SET created_by=disposable_user WHERE id=(g->>'client_targets')::uuid;
    UPDATE public.session_notes SET author_id=disposable_user,reviewed_by=disposable_user WHERE id=(g->>'session_notes')::uuid;
    UPDATE public.behavior_events SET provider_id=disposable_user WHERE id=(g->>'behavior_events')::uuid;
    UPDATE public.target_responses SET provider_id=disposable_user WHERE id=(g->>'target_responses')::uuid;
    DELETE FROM public.users WHERE id=disposable_user;
    IF EXISTS(SELECT 1 FROM public.sessions WHERE id=own_session AND (provider_id IS NOT NULL OR supervisor_id IS NOT NULL OR prepared_by IS NOT NULL OR organization_id<>org))
      OR EXISTS(SELECT 1 FROM public.session_notes WHERE id=(g->>'session_notes')::uuid AND (author_id IS NOT NULL OR reviewed_by IS NOT NULL OR organization_id<>org))
      OR EXISTS(SELECT 1 FROM public.clients WHERE id=(g->>'clients')::uuid AND (assigned_provider_id IS NOT NULL OR organization_id<>org))
      OR EXISTS(SELECT 1 FROM public.client_targets WHERE id=(g->>'client_targets')::uuid AND (created_by IS NOT NULL OR organization_id<>org))
      OR EXISTS(SELECT 1 FROM public.behavior_events WHERE id=(g->>'behavior_events')::uuid AND (provider_id IS NOT NULL OR organization_id<>org))
      OR EXISTS(SELECT 1 FROM public.target_responses WHERE id=(g->>'target_responses')::uuid AND (provider_id IS NOT NULL OR organization_id<>org))
    THEN RAISE EXCEPTION 'User deletion damaged optional references'; END IF;
    DELETE FROM public.client_targets WHERE id=(g->>'client_targets')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.session_targets WHERE id=(g->>'session_targets')::uuid AND client_target_id IS NULL AND organization_id=org AND client_id=(g->>'clients')::uuid)
      THEN RAISE EXCEPTION 'Source target deletion damaged copied target'; END IF;
    DELETE FROM public.client_behaviors WHERE id=(g->>'client_behaviors')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.behavior_events WHERE id=(g->>'behavior_events')::uuid AND client_behavior_id IS NULL AND organization_id=org AND client_id=(g->>'clients')::uuid)
      THEN RAISE EXCEPTION 'Source behavior deletion damaged recorded event'; END IF;
    BEGIN
      DELETE FROM public.children WHERE id=(g->>'children')::uuid;
      RAISE EXCEPTION 'Existing NO ACTION child deletion behavior lost';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
      DELETE FROM public.classrooms WHERE id=(g->>'classrooms')::uuid;
      RAISE EXCEPTION 'Classroom deletion orphaned a template';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    UPDATE public.generated_tasks SET template_id=NULL WHERE id=(g->>'generated_tasks')::uuid;
    DELETE FROM public.task_templates WHERE id=(g->>'task_templates')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=(g->>'tasks')::uuid AND template_id IS NULL AND organization_id=org)
      THEN RAISE EXCEPTION 'Template deletion damaged task tenant'; END IF;
    DELETE FROM public.classrooms WHERE id=(g->>'classrooms')::uuid;
    IF EXISTS(SELECT 1 FROM public.tasks WHERE id=(g->>'tasks')::uuid)
      OR EXISTS(SELECT 1 FROM public.task_completions WHERE task_id=(g->>'tasks')::uuid)
      THEN RAISE EXCEPTION 'Classroom/task completion cascade failed'; END IF;
    DELETE FROM public.sessions WHERE id=own_session;
    IF EXISTS(SELECT 1 FROM public.session_targets WHERE session_id=own_session)
      OR EXISTS(SELECT 1 FROM public.session_notes WHERE session_id=own_session)
      OR EXISTS(SELECT 1 FROM public.target_responses WHERE session_id=own_session)
      OR EXISTS(SELECT 1 FROM public.behavior_events WHERE session_id=own_session)
      THEN RAISE EXCEPTION 'Session child cascade failed'; END IF;

    -- This exception is caught only after every assertion passed. It rolls back
    -- the whole fixture subtransaction, not the migration DDL outside this block.
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Discard successful tenant-test fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$tenant_tests$;

NOTIFY pgrst, 'reload schema';
