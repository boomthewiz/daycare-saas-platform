-- Serialize assignment attempts per destination client. SECURITY INVOKER keeps
-- existing organization, client-management, PIN and subscription rules in force.
CREATE FUNCTION public.apply_client_behavior(p_client_id uuid, p_source_behavior_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  destination public.clients%rowtype;
  source public.client_behaviors%rowtype;
  existing public.client_behaviors%rowtype;
  assigned_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_manage_clients(), false) THEN
    RAISE EXCEPTION 'Client management permission is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO destination FROM public.clients
  WHERE id = p_client_id AND organization_id = public.current_organization_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is unavailable.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO source FROM public.client_behaviors
  WHERE id = p_source_behavior_id AND organization_id = destination.organization_id
    AND (active OR client_id = destination.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Behavior is unavailable.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing FROM public.client_behaviors
  WHERE client_id = destination.id AND organization_id = destination.organization_id
    AND lower(btrim(name)) = lower(btrim(source.name))
    AND measurement_type = source.measurement_type
  ORDER BY active DESC, created_at, id LIMIT 1;
  IF FOUND THEN
    -- Keep existing client-specific guidance and historical event references.
    IF NOT existing.active THEN
      UPDATE public.client_behaviors SET active = true WHERE id = existing.id;
    END IF;
    RETURN existing.id;
  END IF;

  INSERT INTO public.client_behaviors(organization_id, client_id, name, description, measurement_type, active, sort_order)
  SELECT destination.organization_id, destination.id, btrim(source.name), source.description,
    source.measurement_type, true, coalesce(max(sort_order) + 1, 0)
  FROM public.client_behaviors WHERE client_id = destination.id
  RETURNING id INTO assigned_id;
  RETURN assigned_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_client_behavior(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_client_behavior(uuid, uuid) TO authenticated;
