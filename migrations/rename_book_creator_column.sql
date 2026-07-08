-- The books.created_by_admin_id column is no longer admin-only: user-level book
-- uploads (see BookUploadService / POST /books/upload) now store the uploading
-- user's id in this same column so they can access their own unpublished book.
-- Renaming it to created_by_user_id reflects that dual use.
ALTER TABLE books RENAME COLUMN created_by_admin_id TO created_by_user_id;
