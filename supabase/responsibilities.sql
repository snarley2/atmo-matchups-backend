CREATE TABLE IF NOT EXISTS public.office_responsibilities(id uuid PRIMARY KEY,office text NOT NULL,title text NOT NULL,details text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.responsibility_assignments(id uuid PRIMARY KEY,duty_id uuid NOT NULL REFERENCES public.office_responsibilities(id),week_start date NOT NULL,rep_key text NOT NULL,rep_name text NOT NULL,rep_office text NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,updated_by text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS responsibility_assignment_active ON public.responsibility_assignments(duty_id,week_start,rep_key,rep_office) WHERE active=true;
CREATE TABLE IF NOT EXISTS public.responsibility_substitutions(id uuid PRIMARY KEY,assignment_id uuid NOT NULL REFERENCES public.responsibility_assignments(id),work_date date NOT NULL,rep_key text NOT NULL,rep_name text NOT NULL,rep_office text NOT NULL,notes text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,updated_by text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS responsibility_substitution_active ON public.responsibility_substitutions(assignment_id,work_date) WHERE active=true;
ALTER TABLE public.office_responsibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsibility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsibility_substitutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_responsibilities,public.responsibility_assignments,public.responsibility_substitutions FROM anon,authenticated;
