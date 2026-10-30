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
