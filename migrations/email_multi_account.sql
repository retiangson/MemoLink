-- Migration: Support multiple email accounts per user
-- Run once in Supabase SQL editor

-- 1. Remove the old single-account-per-user constraint
ALTER TABLE email_accounts DROP CONSTRAINT IF EXISTS email_accounts_user_id_key;

-- 2. Add composite unique (user can connect same email only once, but multiple different emails)
ALTER TABLE email_accounts
  ADD CONSTRAINT uq_email_accounts_user_email UNIQUE (user_id, email_address);

-- 3. Add email_account_id FK to email_records (nullable — existing records are unaffected)
ALTER TABLE email_records
  ADD COLUMN IF NOT EXISTS email_account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_email_records_email_account_id ON email_records(email_account_id);
