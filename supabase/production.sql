CREATE TABLE IF NOT EXISTS public.production_weeks (
 office text NOT NULL, week_end date NOT NULL,
 spreadsheet_id text NOT NULL, gid bigint NOT NULL, source_title text NOT NULL,
 raw_rows jsonb NOT NULL, records jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(office,week_end)
);
CREATE TABLE IF NOT EXISTS public.production_weekly_reps (
 office text NOT NULL, rep_key text NOT NULL, rep_name text NOT NULL,
 week_end date NOT NULL, electric numeric, gas numeric, production numeric,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(office,rep_key,week_end)
);
CREATE TABLE IF NOT EXISTS public.production_days (
 office text NOT NULL, rep_key text NOT NULL, rep_name text NOT NULL,
 work_date date NOT NULL, worked boolean NOT NULL,
 electric numeric NOT NULL, gas numeric NOT NULL, partials numeric NOT NULL,
 production numeric NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(office,rep_key,work_date)
);
ALTER TABLE public.production_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_weekly_reps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_weeks,public.production_weekly_reps,public.production_days FROM anon,authenticated;
