BEGIN;
CREATE TABLE rejoyce_security.session_choices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 kind text NOT NULL CHECK(kind IN ('tag','location')), label text NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
 domain text NOT NULL DEFAULT 'shared' CHECK(domain IN ('shared','daycare','care_services','aba')),
 active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,organization_id)
);
CREATE UNIQUE INDEX session_choices_normalized ON rejoyce_security.session_choices(organization_id,kind,lower(label));
CREATE TABLE rejoyce_security.session_tags (
 organization_id uuid NOT NULL, session_id uuid NOT NULL, choice_id uuid NOT NULL, label_snapshot text NOT NULL, domain_snapshot text NOT NULL,
 PRIMARY KEY(session_id,choice_id), FOREIGN KEY(session_id,organization_id) REFERENCES public.sessions(id,organization_id),
 FOREIGN KEY(choice_id,organization_id) REFERENCES rejoyce_security.session_choices(id,organization_id)
);
CREATE TABLE rejoyce_security.session_recent_choices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES public.users(id), child_id uuid NOT NULL, provider_id uuid NOT NULL,
 session_type text NOT NULL, location text, tag_ids uuid[] NOT NULL, duration_minutes integer NOT NULL,
 used_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(child_id,organization_id) REFERENCES public.clients(id,organization_id),
 FOREIGN KEY(provider_id,organization_id) REFERENCES public.users(id,organization_id)
);
CREATE TABLE rejoyce_security.session_creation_operations (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), operation_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id),
 payload jsonb NOT NULL,result jsonb NOT NULL, PRIMARY KEY(organization_id,operation_id)
);
ALTER TABLE rejoyce_security.session_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.session_recent_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejoyce_security.session_creation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rejoyce_security.session_choices,rejoyce_security.session_tags,rejoyce_security.session_recent_choices,rejoyce_security.session_creation_operations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rejoyce_security.session_context(p_session uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; choices jsonb; recent jsonb; tags jsonb;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() THEN RAISE EXCEPTION 'Session management required' USING ERRCODE='42501'; END IF;
 IF p_session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sessions WHERE id=p_session AND organization_id=org) THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.label,q.id),'[]') INTO choices FROM (SELECT id,kind,label,domain,active FROM rejoyce_security.session_choices WHERE organization_id=org AND active ORDER BY label,id LIMIT 500) q;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.used_at DESC,q.id),'[]') INTO recent FROM (
  SELECT r.id,r.child_id,r.provider_id,r.session_type,r.location,r.tag_ids,r.duration_minutes,r.used_at
  FROM rejoyce_security.session_recent_choices r
  WHERE r.organization_id=org AND r.user_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.clients WHERE id=r.child_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.users WHERE id=r.provider_id AND organization_id=org AND status='active')
  AND EXISTS(SELECT 1 FROM public.session_types WHERE organization_id=org AND code=r.session_type AND active)
  AND NOT EXISTS(SELECT 1 FROM unnest(r.tag_ids) tag WHERE NOT EXISTS(SELECT 1 FROM rejoyce_security.session_choices WHERE id=tag AND organization_id=org AND active AND kind='tag'))
  ORDER BY r.used_at DESC,r.id LIMIT 10
 ) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',choice_id,'label',label_snapshot,'domain',domain_snapshot) ORDER BY label_snapshot,choice_id),'[]') INTO tags FROM rejoyce_security.session_tags WHERE organization_id=org AND session_id=p_session;
 RETURN jsonb_build_object('organizationId',org,'userId',auth.uid(),'choices',choices,'recent',recent,'tags',tags);
END; $$;
CREATE FUNCTION public.session_context(p_session uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.session_context(p_session) $$;
REVOKE ALL ON FUNCTION rejoyce_security.session_context(uuid),public.session_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.session_context(uuid),public.session_context(uuid) TO authenticated;

CREATE FUNCTION rejoyce_security.save_session_choice(p_kind text,p_label text,p_domain text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; normalized_label text; result uuid; existing_domain text;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 normalized_label:=regexp_replace(btrim(p_label),'[[:space:]]+',' ','g');
 IF p_kind IS NULL OR p_kind NOT IN ('tag','location') OR p_domain IS NULL OR p_domain NOT IN ('shared','daycare','care_services','aba') OR normalized_label IS NULL OR length(normalized_label)<1 OR length(normalized_label)>120 OR p_label ~ '[[:cntrl:]]' OR (p_kind='location' AND p_domain<>'shared') THEN RAISE EXCEPTION 'Invalid saved choice' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT id,domain INTO result,existing_domain FROM rejoyce_security.session_choices WHERE organization_id=org AND kind=p_kind AND lower(session_choices.label)=lower(normalized_label) AND active;
 IF result IS NOT NULL THEN
  IF existing_domain<>p_domain THEN RAISE EXCEPTION 'An existing label has a different domain; select it explicitly' USING ERRCODE='40001'; END IF;
  RETURN result;
 END IF;
 INSERT INTO rejoyce_security.session_choices(organization_id,kind,label,domain,created_by) VALUES(org,p_kind,normalized_label,p_domain,auth.uid()) RETURNING id INTO result;
 RETURN result;
END; $$;
CREATE FUNCTION public.save_session_choice(p_kind text,p_label text,p_domain text DEFAULT 'shared') RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.save_session_choice(p_kind,p_label,p_domain) $$;
REVOKE ALL ON FUNCTION rejoyce_security.save_session_choice(text,text,text),public.save_session_choice(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.save_session_choice(text,text,text),public.save_session_choice(text,text,text) TO authenticated;

CREATE FUNCTION rejoyce_security.create_context_session(p_child uuid,p_provider uuid,p_start timestamptz,p_end timestamptz,p_type text,p_location text,p_tags uuid[],p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; payload jsonb; saved rejoyce_security.session_creation_operations%rowtype; result jsonb; tag_ids uuid[]; duration integer;
BEGIN
 PERFORM rejoyce_security.require_unlocked(); org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501'; END IF;
 IF p_operation IS NULL OR p_tags IS NULL OR cardinality(p_tags)>20 OR array_position(p_tags,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Choose at most 20 valid tags and an operation ID' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO tag_ids FROM unnest(p_tags) id;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
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
END; $$;
CREATE FUNCTION public.create_context_session(p_child uuid,p_provider uuid,p_start timestamptz,p_end timestamptz,p_type text,p_location text DEFAULT NULL,p_tags uuid[] DEFAULT '{}',p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT rejoyce_security.create_context_session(p_child,p_provider,p_start,p_end,p_type,p_location,p_tags,p_operation) $$;
REVOKE ALL ON FUNCTION rejoyce_security.create_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid),public.create_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.create_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid),public.create_context_session(uuid,uuid,timestamptz,timestamptz,text,text,uuid[],uuid) TO authenticated;
CREATE FUNCTION rejoyce_security.save_session_type_choice(p_label text,p_duration integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; normalized_label text; existing public.session_types%rowtype;
BEGIN
 PERFORM rejoyce_security.require_unlocked();org:=public.current_organization_id();
 IF auth.uid() IS NULL OR org IS NULL OR NOT public.can_manage_sessions() OR NOT rejoyce_security.organization_can_write(org) THEN RAISE EXCEPTION 'Session management and editing access required' USING ERRCODE='42501';END IF;
 normalized_label:=regexp_replace(btrim(p_label),'[[:space:]]+',' ','g');
 IF normalized_label IS NULL OR length(normalized_label)<1 OR length(normalized_label)>120 OR p_label ~ '[[:cntrl:]]' OR p_duration IS NULL OR p_duration<1 OR p_duration>1440 THEN RAISE EXCEPTION 'Choose a name and whole duration of 1–1440 minutes' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO existing FROM public.session_types WHERE organization_id=org AND active AND lower(name)=lower(normalized_label) ORDER BY code LIMIT 1;
 IF FOUND THEN
  IF existing.default_duration_minutes IS DISTINCT FROM p_duration THEN RAISE EXCEPTION 'Existing type has a different duration; select it or edit it in Setup' USING ERRCODE='40001'; END IF;
 ELSE
  INSERT INTO public.session_types(organization_id,name,code,default_duration_minutes,active) VALUES(org,normalized_label,'custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,20),p_duration,true) RETURNING * INTO existing;
 END IF;
 RETURN jsonb_build_object('code',existing.code,'name',existing.name);
END;$$;
CREATE FUNCTION public.save_session_type_choice(p_label text,p_duration integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT rejoyce_security.save_session_type_choice(p_label,p_duration)$$;
REVOKE ALL ON FUNCTION rejoyce_security.save_session_type_choice(text,integer),public.save_session_type_choice(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rejoyce_security.save_session_type_choice(text,integer),public.save_session_type_choice(text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
