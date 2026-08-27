-- Deny the anon key Prisma's own bookkeeping table.
--
-- Prisma creates public._prisma_migrations itself, before it applies anything
-- in this directory, so it never passed through a migration and shipped without
-- row-level security. A live probe read it over PostgREST with HTTP 200: the
-- migration names, their checksums and their timestamps, which is a map of the
-- schema and its change history handed to anyone who opens the site.
--
-- No policy and no grant. The application never reads this table; Prisma reaches
-- it on the direct connection as the owner, and a table owner bypasses RLS, so
-- migrate deploy is unaffected.
--
-- IF EXISTS because the table is Prisma's to create. On the normal path
-- prisma migrate deploy has already created it before this file runs, but a
-- fresh database driven some other way must not fail here.

ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY;
