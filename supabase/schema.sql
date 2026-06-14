-- ============================================================
-- Run this entire file in Supabase SQL Editor (one paste).
-- ============================================================

-- 1. pgcrypto for bcrypt password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.admins (
  admin_id      text        PRIMARY KEY,
  passcode_hash text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.updates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_key      text        NOT NULL,
  update_type     text        NOT NULL CHECK (update_type IN ('cancellation', 'venue_change', 'time_change')),
  effective_mode  text        NOT NULL CHECK (effective_mode IN ('single', 'range')),
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  new_venue       text,
  new_start_time  time,
  new_end_time    time,
  reason          text,
  admin_id        text        NOT NULL REFERENCES public.admins(admin_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  is_deleted      boolean     NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_ts   timestamptz NOT NULL DEFAULT now(),
  admin_id    text        NOT NULL,
  course_key  text        NOT NULL,
  update_type text        NOT NULL,
  start_date  date,
  end_date    date,
  prev_state  text,
  new_state   text,
  reason      text
);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash  text        PRIMARY KEY,
  admin_id    text        NOT NULL REFERENCES public.admins(admin_id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. Row-level security (read-only for public; all writes go through edge functions)
ALTER TABLE public.updates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'updates' AND policyname = 'updates_public_read'
  ) THEN
    CREATE POLICY updates_public_read  ON public.updates    FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_public_read'
  ) THEN
    CREATE POLICY audit_public_read    ON public.audit_log  FOR SELECT USING (true);
  END IF;
END $$;

-- 4. verify_admin RPC used by the admin-login edge function
CREATE OR REPLACE FUNCTION public.verify_admin(input_passcode text)
RETURNS TABLE(admin_id text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT admin_id
  FROM   public.admins
  WHERE  is_active = true
    AND  passcode_hash = crypt(input_passcode, passcode_hash)
  LIMIT 1;
$$;

-- 5. Insert admins with hashed passcodes.
--    Change the passcode values before running.
--    You can add more rows or re-run this after changing a passcode.
INSERT INTO public.admins (admin_id, passcode_hash)
VALUES
  ('admin_A', crypt('pass_A', gen_salt('bf'))), -- do not try lmao this wont work
ON CONFLICT (admin_id) DO NOTHING;
