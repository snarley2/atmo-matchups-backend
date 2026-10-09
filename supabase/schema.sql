-- Execute in Supabase SQL Editor before deploying app backend.
-- Client applications never connect to this table directly.
CREATE TABLE IF NOT EXISTS public.project_tabs (
 title text PRIMARY KEY,
 rows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array'),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_tabs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_tabs FROM anon, authenticated;
-- The backend connects using the Supabase Postgres connection string.
