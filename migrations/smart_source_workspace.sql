-- Smart Source Workspace: metadata and editable annotation data only.
-- No original file, audio, Blob, or base64 data is stored in these tables.

CREATE TABLE IF NOT EXISTS source_files (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    source_type VARCHAR(40) NOT NULL,
    original_filename VARCHAR(500) NOT NULL,
    mime_type VARCHAR(200),
    file_size BIGINT,
    onedrive_drive_id VARCHAR(255) NOT NULL,
    onedrive_item_id VARCHAR(500) NOT NULL,
    onedrive_web_url TEXT,
    onedrive_etag VARCHAR(500),
    extraction_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    cache_status VARCHAR(30) NOT NULL DEFAULT 'unknown',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_source_file_note_item UNIQUE(user_id, note_id, onedrive_drive_id, onedrive_item_id)
);
CREATE INDEX IF NOT EXISTS ix_source_files_note ON source_files(user_id, note_id);

CREATE TABLE IF NOT EXISTS book_note_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_book_note_link UNIQUE(user_id, book_id, note_id)
);

CREATE TABLE IF NOT EXISTS file_annotations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    source_file_id INTEGER REFERENCES source_files(id) ON DELETE CASCADE,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    page_number INTEGER,
    location_anchor JSONB,
    annotation_type VARCHAR(40) NOT NULL,
    strokes_json JSONB,
    highlight_data JSONB,
    comment_text TEXT,
    color VARCHAR(40),
    pen_size FLOAT,
    tool_type VARCHAR(40),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_file_annotations_note ON file_annotations(user_id, note_id, source_file_id);

CREATE TABLE IF NOT EXISTS note_timeline_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    source_file_id INTEGER REFERENCES source_files(id) ON DELETE CASCADE,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_summary VARCHAR(500) NOT NULL,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_note_timeline_events_note ON note_timeline_events(user_id, note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recording_metadata (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    file_name VARCHAR(500) NOT NULL,
    duration_seconds FLOAT NOT NULL,
    local_only BOOLEAN NOT NULL DEFAULT TRUE,
    transcript_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
    transcript_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recording_metadata_note ON recording_metadata(user_id, note_id);
