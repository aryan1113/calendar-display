-- Add columns to support bulk_add updates
ALTER TABLE public.updates
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS class_code TEXT;

-- Update the CHECK constraint for update_type to include 'bulk_add'
ALTER TABLE public.updates
  DROP CONSTRAINT IF EXISTS updates_update_type_check;

ALTER TABLE public.updates
  ADD CONSTRAINT updates_update_type_check
  CHECK (update_type IN ('cancellation', 'venue_change', 'time_change', 'bulk_add'));
