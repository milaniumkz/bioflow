// Protected server maintenance. Inspection is read-only; alignment never moves business rows.
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient, Prisma } = backendRequire("@prisma/client");
const definitions = [
  ["OPERATIONS_MANAGER", "priemka"],
  ["WASH_OPERATOR", "moyka"],
  ["PACKER", "upakovka"],
  ["DRIVER", "voditel"],
  ["COLLECTOR", "sborschik"],
  ["OWNER", "vladelets"],
];
const businessModels = [
  "MaterialBatch",
  "Waybill",
  "Acceptance",
  "InventoryMovement",
  "WarehouseTransfer",
  "WashingBatch",
  "ProductionBatch",
  "WriteOff",
  "Shipment",
  "BatchOperation",
  "BatchMovement",
  "LaboratoryAnalysis",
  "ProcessRun",
  "BigBag",
  "CustomerDelivery",
  "CustomerDeliveryEvent",
  "RoutePoint",
  "File",
];
function selectedEmails(suffix = "") {
  if (!/^(?:-[a-z0-9]{1,12})?$/.test(suffix))
    throw Error("Invalid account suffix");
  return definitions.map(([code, alias]) => ({
    code,
    email: `${alias}${suffix}@collection.local`,
  }));
}
async function context(tx, oldLogin, bootstrapEmail, suffix = "") {
  if (!/^\+[1-9]\d{6,14}$/.test(oldLogin || "") || !bootstrapEmail)
    throw Error("Explicit old owner selector required");
  const old = await tx.user.findFirst({
    where: {
      phone: {
        in: [
          oldLogin,
          oldLogin.slice(1),
          ...(oldLogin.startsWith("+7") ? ["8" + oldLogin.slice(2)] : []),
        ],
      },
    },
    include: { userRoles: { include: { role: true } } },
  });
  const bootstrap = await tx.user.findUnique({
      where: { email: bootstrapEmail },
    }),
    selected = selectedEmails(suffix);
  const accounts = await tx.user.findMany({
    where: { email: { in: selected.map((e) => e.email) } },
    include: { userRoles: { include: { role: true } } },
  });
  if (
    !old ||
    old.isBlocked ||
    !old.userRoles.some((r) => r.role.code === "OWNER") ||
    !bootstrap ||
    accounts.length !== 6
  )
    throw Error("Owner and six accounts are required");
  for (const e of selected) {
    const a = accounts.find((a) => a.email === e.email);
    if (
      !a ||
      a.id === old.id ||
      a.id === bootstrap.id ||
      a.userRoles.length !== 1 ||
      a.userRoles[0].role.code !== e.code
    )
      throw Error("Account identity mismatch");
  }
  const orgs = [...new Set(accounts.map((a) => a.organizationId))];
  if (orgs.length !== 1)
    throw Error("Mixed account organizations; no changes allowed");
  const ids = accounts.map((a) => a.id),
    drivers = await tx.driver.findMany({ where: { userId: { in: ids } } });
  return {
    old,
    bootstrap,
    accounts,
    selected,
    ids,
    drivers,
    sourceId: orgs[0],
    targetId: old.organizationId,
  };
}
async function activity(tx, c) {
  let business = false;
  for (const name of businessModels) {
    const m = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
    if (!m) continue;
    const fields = m.fields.filter(
      (f) =>
        f.kind === "scalar" &&
        f.type === "String" &&
        (/ById$/.test(f.name) || f.name === "userId"),
    );
    if (!fields.length) continue;
    if (
      await tx[name[0].toLowerCase() + name.slice(1)].count({
        where: { OR: fields.map((f) => ({ [f.name]: { in: c.ids } })) },
      })
    )
      business = true;
  }
  if (
    await tx.auditLog.count({
      where: {
        userId: { in: c.ids },
        action: { in: ["create", "update", "archive"] },
        entity: { notIn: ["Device", "devices"] },
      },
    })
  )
    business = true;
  const driverIds = c.drivers.map((d) => d.id);
  const assigned = driverIds.length
    ? (await tx.waybill.count({ where: { driverId: { in: driverIds } } })) +
      (await tx.customerDelivery.count({
        where: { driverId: { in: driverIds } },
      }))
    : 0;
  const notices = await tx.notification.findMany({
    where: { userId: { in: c.ids } },
    select: { id: true },
  });
  const pending = await tx.pushDelivery.count({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      notificationId: { in: notices.map((n) => n.id) },
    },
  });
  return { business, assigned: assigned > 0, pending: pending > 0 };
}
async function inspect(prisma, oldLogin, bootstrapEmail, suffix = "") {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const c = await context(tx, oldLogin, bootstrapEmail, suffix),
        a = await activity(tx, c);
      return {
        oldOwnerFound: true,
        newAccountsFound: 6,
        newAccountsOneOrganization: true,
        oldAndNewSameOrganization: c.sourceId === c.targetId,
        newAndBootstrapSameOrganization:
          c.sourceId === c.bootstrap.organizationId,
        oldOwnerUsesTrainingNamedOrganization:
          c.targetId === "collection-role-training-v1",
        newAccountsHaveBusinessActivity: a.business,
        newDriverHasAssignments: a.assigned,
        newDriverHasCounterparty: c.drivers.some((d) => d.counterpartyId),
        newAccountsHavePendingPush: a.pending,
        oldOwnerOrganizationHasBatches:
          (await tx.materialBatch.count({
            where: { organizationId: c.targetId },
          })) > 0,
        newOrganizationHasBatches:
          (await tx.materialBatch.count({
            where: { organizationId: c.sourceId },
          })) > 0,
      };
    },
    { timeout: 30000 },
  );
}
function unchangedCredentials(accounts) {
  return accounts
    .map((a) => ({
      id: a.id,
      email: a.email,
      phone: a.phone,
      passwordHash: a.passwordHash,
      mustChangePassword: a.mustChangePassword,
      accessAllObjects: a.accessAllObjects,
      roles: a.userRoles.map((r) => r.roleId).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function guardFresh(c, a) {
  if (
    a.business ||
    a.assigned ||
    a.pending ||
    c.drivers.length !== 1 ||
    c.drivers.some(
      (d) =>
        d.counterpartyId || d.archivedAt || d.organizationId !== c.sourceId,
    )
  )
    throw Error(
      "Accounts have dependent activity; alignment needs a separate data review",
    );
}
async function dashboardMatch(prisma, oldLogin, bootstrapEmail, suffix) {
  const { OwnerDashboard } = backendRequire(
    "./dist/processing/owner-dashboard.js",
  );
  const canonical = (v) =>
    Array.isArray(v)
      ? v
          .map(canonical)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const c = await context(tx, oldLogin, bootstrapEmail, suffix);
      if (c.sourceId !== c.targetId) return false;
      const service = new OwnerDashboard(tx),
        user = (id) => ({
          id,
          organizationId: c.targetId,
          roles: ["OWNER"],
          permissions: [],
          accessAllObjects: true,
          warehouseScopeIds: [],
          extractionScopeIds: [],
        });
      const first = await service.read({}, user(c.old.id)),
        second = await service.read(
          {},
          user(c.accounts.find((a) => a.userRoles[0].role.code === "OWNER").id),
        );
      return (
        createHash("sha256")
          .update(
            JSON.stringify(
              canonical(
                JSON.parse(
                  JSON.stringify({
                    groups: first.groups,
                    filters: first.filters,
                  }),
                ),
              ),
            ),
          )
          .digest("hex") ===
        createHash("sha256")
          .update(
            JSON.stringify(
              canonical(
                JSON.parse(
                  JSON.stringify({
                    groups: second.groups,
                    filters: second.filters,
                  }),
                ),
              ),
            ),
          )
          .digest("hex")
      );
    },
    { isolationLevel: "RepeatableRead", timeout: 60000 },
  );
}
async function align(prisma, r, bootstrapEmail, options = {}) {
  if (
    r.purpose !== "align-work-org-v1" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      r.id || "",
    )
  )
    throw Error("Explicit alignment request required");
  const drainMs = options.drainMs ?? 31000;
  if (
    drainMs !== 31000 &&
    !new URL(process.env.DATABASE_URL || "http://invalid").pathname.endsWith(
      "_spec",
    )
  )
    throw Error("Production request drain cannot be skipped");
  const markerId = `work-org-align:${r.id}`,
    pendingId = `work-org-pending:${r.id}`;
  let staged = null,
    committed = false;
  try {
    staged = await prisma.$transaction(
      async (tx) => {
        const c = await context(tx, r.oldLogin, bootstrapEmail, r.suffix),
          done = await tx.auditLog.findUnique({ where: { id: markerId } });
        if (c.sourceId === c.targetId) {
          if (c.accounts.some((a) => a.isBlocked))
            throw Error("An account is blocked");
          return { done: true };
        }
        if (done) throw Error("Alignment request target changed");
        const proof = await tx.auditLog.findMany({
          where: { action: "users.provision-work-roles" },
          select: { newValue: true },
        });
        if (
          !proof.some(
            (p) =>
              Array.isArray(p.newValue?.accounts) &&
              c.selected.every((e) =>
                p.newValue.accounts.some(
                  (a) =>
                    a.code === e.code &&
                    a.email === e.email &&
                    c.accounts.some(
                      (u) => u.id === a.id && u.email === a.email,
                    ),
                ),
              ),
          )
        )
          throw Error("Account provenance mismatch");
        const pending = await tx.auditLog.findUnique({
          where: { id: pendingId },
        });
        if (
          pending &&
          (pending.organizationId !== c.targetId ||
            pending.newValue?.sourceId !== c.sourceId ||
            pending.newValue?.targetOwnerId !== c.old.id ||
            JSON.stringify([...pending.newValue.ids].sort()) !==
              JSON.stringify([...c.ids].sort()))
        )
          throw Error("Pending request mismatch");
        const blocked = c.accounts.filter((a) => a.isBlocked).length;
        if ((blocked && !pending) || (blocked !== 0 && blocked !== 6))
          throw Error("Existing account block cannot be overridden");
        guardFresh(c, await activity(tx, c));
        await tx.user.updateMany({
          where: { id: { in: c.ids }, organizationId: c.sourceId },
          data: { isBlocked: true },
        });
        await tx.refreshToken.updateMany({
          where: { userId: { in: c.ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: { in: c.ids }, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (!pending)
          await tx.auditLog.create({
            data: {
              id: pendingId,
              organizationId: c.targetId,
              userId: c.old.id,
              action: "users.align-work-pending",
              entity: "User",
              newValue: {
                ids: c.ids,
                sourceId: c.sourceId,
                targetOwnerId: c.old.id,
              },
              reason:
                "Quiesce only the six new accounts before correcting their organization",
            },
          });
        return {
          done: false,
          ids: c.ids,
          sourceId: c.sourceId,
          targetId: c.targetId,
        };
      },
      { isolationLevel: "Serializable", timeout: 30000 },
    );
    if (!staged.done) {
      await new Promise((resolve) => setTimeout(resolve, drainMs));
      await prisma.$transaction(
        async (tx) => {
          const c = await context(tx, r.oldLogin, bootstrapEmail, r.suffix);
          if (
            c.sourceId !== staged.sourceId ||
            c.targetId !== staged.targetId ||
            c.accounts.some((a) => !a.isBlocked)
          )
            throw Error("Account state changed while draining requests");
          guardFresh(c, await activity(tx, c));
          const before = JSON.stringify(unchangedCredentials(c.accounts));
          const [warehouses, sites] = await Promise.all([
            tx.warehouse.findMany({
              where: { organizationId: c.targetId, archivedAt: null },
              select: { id: true },
            }),
            tx.extractionSite.findMany({
              where: { organizationId: c.targetId, archivedAt: null },
              select: { id: true },
            }),
          ]);
          for (const a of c.accounts) {
            const code = a.userRoles[0].role.code;
            await tx.user.update({
              where: { id: a.id, organizationId: c.sourceId },
              data: {
                organizationId: c.targetId,
                isBlocked: false,
                counterpartyScopeId: null,
                warehouseScopeIds:
                  code === "DRIVER" ? [] : warehouses.map((w) => w.id),
                extractionScopeIds:
                  code === "COLLECTOR" ? sites.map((s) => s.id) : [],
              },
            });
          }
          await tx.driver.update({
            where: { id: c.drivers[0].id },
            data: { organizationId: c.targetId },
          });
          const after = await tx.user.findMany({
            where: { id: { in: c.ids } },
            include: { userRoles: { include: { role: true } } },
          });
          if (
            after.length !== 6 ||
            after.some((a) => a.organizationId !== c.targetId || a.isBlocked) ||
            JSON.stringify(unchangedCredentials(after)) !== before
          )
            throw Error("Credential or role preservation check failed");
          await tx.auditLog.create({
            data: {
              id: markerId,
              organizationId: c.targetId,
              userId: c.old.id,
              action: "users.align-work-organization",
              entity: "User",
              newValue: {
                sourceId: c.sourceId,
                targetId: c.targetId,
                accounts: c.selected.map((e) => ({
                  ...e,
                  id: c.accounts.find((a) => a.email === e.email).id,
                })),
              },
              reason:
                "Correct six new accounts to the organization explicitly identified by the old owner login; no business rows moved",
            },
          });
        },
        { isolationLevel: "Serializable", timeout: 30000 },
      );
    }
    committed = true;
  } finally {
    if (staged && !staged.done && !committed)
      await prisma.user.updateMany({
        where: {
          id: { in: staged.ids },
          organizationId: staged.sourceId,
          isBlocked: true,
        },
        data: { isBlocked: false },
      });
  }
  const matched = await dashboardMatch(
    prisma,
    r.oldLogin,
    bootstrapEmail,
    r.suffix,
  );
  if (!matched)
    throw Error(
      "Owner dashboard comparison failed; inspect before any further action",
    );
  return {
    alignedAccounts: staged.done ? 0 : 6,
    alignedToRequestedOldOwner: true,
    credentialsAndRolesPreserved: true,
    businessRowsMoved: false,
    ownerDashboardDataMatches: true,
  };
}
module.exports = { inspect, align, dashboardMatch };
if (
  process.env.COLLECTION_WORK_ORG_INSPECT_JSON ||
  process.env.COLLECTION_WORK_ORG_ALIGN_JSON
) {
  const prisma = new PrismaClient();
  (async () => {
    const inspectRaw = process.env.COLLECTION_WORK_ORG_INSPECT_JSON,
      alignRaw = process.env.COLLECTION_WORK_ORG_ALIGN_JSON;
    delete process.env.COLLECTION_WORK_ORG_INSPECT_JSON;
    delete process.env.COLLECTION_WORK_ORG_ALIGN_JSON;
    if (!!inspectRaw === !!alignRaw)
      throw Error("One explicit operation required");
    const r = JSON.parse(inspectRaw || alignRaw);
    if (inspectRaw) {
      if (r.purpose !== "inspect-work-org-v1")
        throw Error("Invalid read-only purpose");
      console.log(
        JSON.stringify(
          await inspect(
            prisma,
            r.oldLogin,
            process.env.BOOTSTRAP_OWNER_EMAIL,
            r.suffix,
          ),
        ),
      );
    } else
      console.log(
        JSON.stringify(
          await align(prisma, r, process.env.BOOTSTRAP_OWNER_EMAIL),
        ),
      );
  })()
    .catch(() => {
      console.error(
        "Organization operation failed; no business records were moved or deleted. Review the protected operation without logging private records.",
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
