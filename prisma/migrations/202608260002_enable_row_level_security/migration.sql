-- Deny the anon key every table in public.
--
-- Prisma creates tables with no row-level security. Supabase's default grants
-- give the anon role access to everything in public and PostgREST publishes it
-- at /rest/v1/<table>. The anon key is NEXT_PUBLIC_, so it ships in the
-- JavaScript of every page: without this, anyone who opened the site could read
-- leads.author and leads.text through the REST API.
--
-- No policies. Deny-all for anon is the intent, not an oversight to fix later.
-- The application reaches data through Prisma on the direct Postgres connection
-- as the postgres role, which bypasses RLS, and the Supabase client is used
-- only for supabase.auth.* and never for table reads.
--
-- ENABLE ROW LEVEL SECURITY on an already-enabled table is a no-op, so this is
-- safe to apply to a database that was fixed by hand in the SQL editor.
--
-- Every future table ships with RLS enabled in the migration that creates it.
-- tests/rls-coverage.test.ts refuses the suite when one is missing.

ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_heartbeats ENABLE ROW LEVEL SECURITY;
