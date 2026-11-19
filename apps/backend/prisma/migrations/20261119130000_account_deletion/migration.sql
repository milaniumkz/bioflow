ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Deleted identities remain only as references from the organization's ledger.
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_identity"
CHECK ("deletedAt" IS NULL OR (
  "isBlocked" = TRUE AND "email" IS NULL AND "phone" IS NULL
  AND "fullName" = 'Deleted account' AND "accessAllObjects" = FALSE
  AND "counterpartyScopeId" IS NULL
  AND cardinality("warehouseScopeIds") = 0
  AND cardinality("extractionScopeIds") = 0
));
