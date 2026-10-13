CREATE TABLE IF NOT EXISTS public.coaching_methods (
 id uuid PRIMARY KEY,
 office text NOT NULL,
 gap_key text NOT NULL CHECK(gap_key IN ('talkToStop','stopToZip','zipToPresentation','presentationToInfo','infoToClose')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 details text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_methods_office_idx ON public.coaching_methods(office,gap_key);
CREATE TABLE IF NOT EXISTS public.coaching_rep_methods (
 office text NOT NULL, rep_key text NOT NULL, method_id uuid NOT NULL REFERENCES public.coaching_methods(id),
 implemented boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
 PRIMARY KEY(office,rep_key,method_id)
);
ALTER TABLE public.coaching_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_rep_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coaching_methods,public.coaching_rep_methods FROM anon,authenticated;
