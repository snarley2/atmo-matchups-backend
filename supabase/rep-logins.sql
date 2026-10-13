CREATE TABLE IF NOT EXISTS public.rep_id_aliases (
 office text NOT NULL, old_key text NOT NULL, rep_id text NOT NULL,
 PRIMARY KEY(office,old_key)
);
ALTER TABLE public.rep_id_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_id_aliases FROM anon,authenticated;
