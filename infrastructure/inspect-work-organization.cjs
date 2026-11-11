// Server-loopback maintenance only. This operation enforces a read-only DB transaction.
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient, Prisma } = backendRequire("@prisma/client");
const emails = [
  "priemka",
  "moyka",
  "upakovka",
  "voditel",
  "sborschik",
  "vladelets",
].map((a) => a + "@collection.local");
async function inspect(prisma, oldLogin, bootstrapEmail) {
  if (!/^\+[1-9]\d{6,14}$/.test(oldLogin || "") || !bootstrapEmail)
    throw Error("Owner selector required");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
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
        select: {
          id: true,
          organizationId: true,
          isBlocked: true,
          userRoles: { include: { role: true } },
        },
      });
      const bootstrap = await tx.user.findUnique({
        where: { email: bootstrapEmail },
        select: { organizationId: true },
      });
      const accounts = await tx.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true, organizationId: true },
      });
      if (
        !old ||
        !old.userRoles.some((r) => r.role.code === "OWNER") ||
        old.isBlocked ||
        !bootstrap ||
        accounts.length !== 6
      )
        throw Error("Expected owner and six accounts not found");
      const ids = accounts.map((a) => a.id),
        orgs = [...new Set(accounts.map((a) => a.organizationId))];
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
      let hasActivity = false;
      for (const name of businessModels) {
        const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
        if (!model) continue;
        const fields = model.fields.filter(
          (f) =>
            f.kind === "scalar" &&
            f.type === "String" &&
            (/ById$/.test(f.name) || f.name === "userId"),
        );
        if (!fields.length) continue;
        const delegate = name[0].toLowerCase() + name.slice(1);
        if (
          await tx[delegate].count({
            where: { OR: fields.map((f) => ({ [f.name]: { in: ids } })) },
          })
        )
          hasActivity = true;
      }
      const referenceChanges = await tx.auditLog.count({
        where: {
          userId: { in: ids },
          action: { in: ["create", "update", "archive"] },
          entity: { notIn: ["Device", "devices"] },
        },
      });
      const drivers = await tx.driver.findMany({
          where: { userId: { in: ids } },
          select: { id: true, counterpartyId: true },
        }),
        driverIds = drivers.map((d) => d.id);
      const assigned = driverIds.length
        ? (await tx.waybill.count({ where: { driverId: { in: driverIds } } })) +
          (await tx.customerDelivery.count({
            where: { driverId: { in: driverIds } },
          }))
        : 0;
      const pending = await tx.pushDelivery.count({
        where: {
          status: { in: ["PENDING", "PROCESSING"] },
          notificationId: {
            in: (
              await tx.notification.findMany({
                where: { userId: { in: ids } },
                select: { id: true },
              })
            ).map((n) => n.id),
          },
        },
      });
      return {
        oldOwnerFound: true,
        newAccountsFound: 6,
        newAccountsOneOrganization: orgs.length === 1,
        oldAndNewSameOrganization:
          orgs.length === 1 && orgs[0] === old.organizationId,
        newAndBootstrapSameOrganization:
          orgs.length === 1 && orgs[0] === bootstrap.organizationId,
        oldOwnerUsesTrainingNamedOrganization:
          old.organizationId === "collection-role-training-v1",
        newAccountsHaveBusinessActivity: hasActivity || referenceChanges > 0,
        newDriverHasAssignments: assigned > 0,
        newDriverHasCounterparty: drivers.some((d) => d.counterpartyId),
        newAccountsHavePendingPush: pending > 0,
        oldOwnerOrganizationHasBatches:
          (await tx.materialBatch.count({
            where: { organizationId: old.organizationId },
          })) > 0,
        newOrganizationHasBatches:
          orgs.length === 1 &&
          (await tx.materialBatch.count({
            where: { organizationId: orgs[0] },
          })) > 0,
      };
    },
    { timeout: 30000 },
  );
}
module.exports = { inspect };
if (process.env.COLLECTION_WORK_ORG_INSPECT_JSON) {
  const prisma = new PrismaClient();
  (async () => {
    const r = JSON.parse(process.env.COLLECTION_WORK_ORG_INSPECT_JSON);
    delete process.env.COLLECTION_WORK_ORG_INSPECT_JSON;
    if (r.purpose !== "inspect-work-org-v1") throw Error("Invalid purpose");
    console.log(
      JSON.stringify(
        await inspect(prisma, r.oldLogin, process.env.BOOTSTRAP_OWNER_EMAIL),
      ),
    );
  })()
    .catch(() => {
      console.error(
        "Read-only organization inspection failed; no account or business data changed",
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
