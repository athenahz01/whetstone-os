-- Defence in depth on the one gate whose whole job is guaranteeing a human
-- signed off.
--
-- `approved_by` is TEXT, so the query filter `approved_by <> ''` is TRUE for a
-- whitespace-only value: SQL does no trimming, and only char(n) would ignore
-- trailing spaces. That row is returned by the query and refused one layer up
-- by the trim in lib/core/workflow.ts. This constraint means it cannot be
-- written at all, so all three layers hold independently rather than one
-- carrying the property alone.
--
-- A separate migration rather than an edit to 202608260003, because that one is
-- already committed and may have been deployed. Editing an applied migration
-- leaves drift Prisma will not re-apply.

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_approved_by_not_blank CHECK (btrim(approved_by) <> '');
