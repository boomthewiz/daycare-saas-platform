-- Cover the new tenant relationship identified by the post-migration advisor.
SET LOCAL lock_timeout = '5s';
CREATE INDEX owner_requests_organization_id_idx ON public.owner_requests (organization_id);
