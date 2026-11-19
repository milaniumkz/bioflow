# Account Deletion Migration Review

Migration: `20261119130000_account_deletion`.

- Adds a nullable `User.deletedAt` column and an invariant for deleted identities.
- Existing rows remain unchanged: the new field is null and the check passes.
- No tables, rows, columns, stock, files or business records are dropped by the migration.
- Deletion occurs only through authenticated `DELETE /auth/account`, for the bearer subject, after password verification and an explicit `DELETE` confirmation. There is no target user ID parameter.
- The transaction removes the account's credentials, devices, personal notifications, roles and assignments. A non-loginable anonymized reference remains for ledger integrity; organization operations and security audit records are retained and disclosed in the UI.
- User row locks serialize session/device issuance against deletion. Organization user administration uses the existing organization advisory lock. Deleted identities cannot be unblocked or repopulated through user administration.
- Roll out backend/migration before the new web form. Do not roll back or restore production data. The additive column may stay during an application-only rollback.
- Verify on an isolated `*_spec` database first. Never delete the Apple reviewer account or a real employee account for QA.
