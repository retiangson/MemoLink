-- Migration: Add color to book highlights
-- Run once in Supabase SQL editor

ALTER TABLE book_highlights
  ADD COLUMN IF NOT EXISTS color VARCHAR(20) NOT NULL DEFAULT 'yellow';
