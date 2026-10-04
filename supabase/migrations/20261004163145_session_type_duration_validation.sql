-- Numeric without a scale preserves fractional request values until validation.
-- An integer column (or numeric(p,0)) can round them before CHECK evaluation.
ALTER TABLE public.session_types
  ALTER COLUMN default_duration_minutes TYPE numeric
  USING default_duration_minutes::numeric;

-- NOT VALID preserves legacy NULL/out-of-range rows without modifying them.
-- All INSERTs/UPDATEs, including ON CONFLICT updates, must satisfy this check.
-- Legacy rows remain readable; any subsequent save must correct their duration.
ALTER TABLE public.session_types
  ADD CONSTRAINT session_types_duration_supported_check
  CHECK (
    default_duration_minutes IS NOT NULL
    AND default_duration_minutes BETWEEN 1 AND 1440
    AND default_duration_minutes = trunc(default_duration_minutes)
  ) NOT VALID;

COMMENT ON COLUMN public.session_types.default_duration_minutes IS
  'Required whole minutes, 1 through 1440. Unscaled numeric prevents fractional input rounding. Legacy invalid rows remain readable until corrected.';

NOTIFY pgrst, 'reload schema';
