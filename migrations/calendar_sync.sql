-- Migration: Calendar recurrence + Google Calendar two-way sync
-- Run once in Supabase SQL editor

-- 1. Reminder/calendar-event fields
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NULL,
  ADD COLUMN IF NOT EXISTS end_time VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS calendar_account_id INTEGER NULL REFERENCES email_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_reminders_google_event_id ON reminders(google_event_id);
CREATE INDEX IF NOT EXISTS ix_reminders_calendar_account_id ON reminders(calendar_account_id);

-- 2. Track granted OAuth scopes so we can detect "connected but Calendar scope not yet granted"
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS granted_scope TEXT NULL;
