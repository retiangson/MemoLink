-- Run this in Supabase SQL editor (or any PostgreSQL client)
CREATE TABLE IF NOT EXISTS desktop_commands (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command_type VARCHAR(50) NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    result      TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_desktop_commands_user_status
    ON desktop_commands (user_id, status);
