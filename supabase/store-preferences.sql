CREATE TABLE IF NOT EXISTS public.rep_store_preferences (
 office text NOT NULL, rep_key text NOT NULL,
 store_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(store_ids)='array' AND jsonb_array_length(store_ids)<=5),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(office,rep_key)
);
CREATE TABLE IF NOT EXISTS public.store_next_up (
 scope text NOT NULL, work_date date NOT NULL, team_id text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,work_date)
);
ALTER TABLE public.rep_store_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_next_up ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_store_preferences,public.store_next_up FROM anon,authenticated;
