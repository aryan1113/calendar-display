-- Class-wide alerts: quizzes, simulations, submissions, deadlines.
-- Published by admins (like cancellations/venue changes) and visible to every visitor.
-- Same pattern as public.updates: public SELECT via RLS, all writes go through the
-- publish-alert edge function using the service role key (no anon INSERT/UPDATE policy).

CREATE TABLE IF NOT EXISTS public.class_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  alert_type  text        NOT NULL CHECK (alert_type IN ('quiz', 'simulation', 'submission', 'deadline', 'other')),
  course_key  text,
  event_date  date        NOT NULL,
  event_time  time,
  notes       text,
  admin_id    text        NOT NULL REFERENCES public.admins(admin_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_deleted  boolean     NOT NULL DEFAULT false
);

ALTER TABLE public.class_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'class_alerts' AND policyname = 'class_alerts_public_read'
  ) THEN
    CREATE POLICY class_alerts_public_read ON public.class_alerts FOR SELECT USING (true);
  END IF;
END $$;
