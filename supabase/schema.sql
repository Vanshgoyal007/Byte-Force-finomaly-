-- ==============================================================================
-- Finomaly Database Schema for Supabase (PostgreSQL)
-- Hardened with Explicit Row Level Security (RLS)
-- ==============================================================================
-- Run this script in your Supabase project's SQL Editor to create and protect
-- tables and indexes for behavioral biometrics profile storage and audit logging.

-- 1. Profiles Table: stores enrolled baseline models and consent
CREATE TABLE IF NOT EXISTS profiles (
  user_id text PRIMARY KEY,
  baseline jsonb NOT NULL,
  sessions_count int DEFAULT 0,
  consent boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Audit Logs Table: immutable audit trail of all verification attempts
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  score numeric,
  band text,
  features jsonb,
  flags jsonb,
  created_at timestamptz DEFAULT now()
);

-- Index on user_id and created_at for fast retrieval of audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created 
  ON audit_logs (user_id, created_at DESC);

-- 3. Row Level Security (RLS) Hardening
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Explicit zero-trust policies: deny all direct client-side operations using anon/authenticated keys.
DROP POLICY IF EXISTS "Deny all public direct access on profiles" ON profiles;
CREATE POLICY "Deny all public direct access on profiles"
  ON profiles
  FOR ALL
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "Deny all public direct access on audit_logs" ON audit_logs;
CREATE POLICY "Deny all public direct access on audit_logs"
  ON audit_logs
  FOR ALL
  TO anon, authenticated
  USING (false);

-- Note: The Finomaly backend communicates exclusively via server-side route handlers
-- using the private SUPABASE_SERVICE_ROLE_KEY. Direct browser access to database tables
-- is strictly blocked.

-- 4. Authenticated banking demo data. The service-role key is used only by
-- server routes after they verify the Supabase Auth cookie and derive auth.uid().
CREATE TABLE IF NOT EXISTS banking_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  baseline jsonb NOT NULL,
  sessions_count smallint NOT NULL CHECK (sessions_count BETWEEN 3 AND 10000),
  profile_revision integer NOT NULL DEFAULT 1,
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Existing installations began with a fixed three-session check. Profiles may
-- now accept bounded updates across eligible sessions.
ALTER TABLE banking_profiles
  DROP CONSTRAINT IF EXISTS banking_profiles_sessions_count_check;
ALTER TABLE banking_profiles
  ADD CONSTRAINT banking_profiles_sessions_count_check
  CHECK (sessions_count BETWEEN 3 AND 10000);
ALTER TABLE banking_profiles
  ADD COLUMN IF NOT EXISTS profile_revision integer NOT NULL DEFAULT 1;
ALTER TABLE banking_profiles
  DROP CONSTRAINT IF EXISTS banking_profiles_profile_revision_check;
ALTER TABLE banking_profiles
  ADD CONSTRAINT banking_profiles_profile_revision_check
  CHECK (profile_revision BETWEEN 1 AND 1000000);

CREATE TABLE IF NOT EXISTS banking_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 8240),
  new_beneficiary boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (
    status IN ('held', 'awaiting-verification', 'allowed', 'completed', 'cancelled')
  ),
  assessment jsonb NOT NULL,
  synthetic_observation boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banking_transactions_user_created
  ON banking_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS banking_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES banking_transactions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN ('evaluated', 'step_up_verified', 'completed', 'cancelled')
  ),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banking_audit_events_user_created
  ON banking_audit_events (user_id, created_at DESC);

ALTER TABLE banking_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE banking_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE banking_audit_events ENABLE ROW LEVEL SECURITY;

-- There are intentionally no anon/authenticated policies on the new tables.
-- Browser clients cannot read or alter financial state directly. Server routes
-- validate the user's Supabase Auth session, scope every query by that user ID,
-- then use the server-only service role key.
