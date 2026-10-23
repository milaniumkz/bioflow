// Protected SSH workflow only. Creates an isolated training organization;
// never changes existing passwords, role definitions or operational records.
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient } = backendRequire("@prisma/client");
const argon2 = backendRequire("argon2");
const prisma = new PrismaClient();
const organizationId = "collection-role-training-v1";
const organizationName = "Collection — учебная организация";
const codes = [
  "OWNER",
  "ADMIN",
  "COLLECTOR",
  "DRIVER",
  "LAB_TECHNICIAN",
  "WASH_RECEIVER",
  "WASH_OPERATOR",
  "DRYING_OPERATOR",
  "FINISHED_RECEIVER",
  "PACKER",
  "SALES_STOREKEEPER",
  "CONTRACTOR_REP",
  "RECEIVER",
  "PRODUCTION_OPERATOR",
  "DISPATCHER",
  "EXTRACTION_OPERATOR",
  "LOADING_OPERATOR",
  "WAREHOUSE_OPERATOR",
  "AUDITOR",
];
async function main() {
  const { temporaryPassword, purpose } = JSON.parse(
    process.env.COLLECTION_TRAINING_REQUEST || "{}",
  );
  delete process.env.COLLECTION_TRAINING_REQUEST;
  if (
    purpose !== "isolated-role-training-v1" ||
    typeof temporaryPassword !== "string" ||
    temporaryPassword.length < 6 ||
    temporaryPassword.length > 128
  )
    throw Error("Invalid request");
  const passwordHash = await argon2.hash(temporaryPassword);
  const accounts = await prisma.$transaction(
    async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: true } });
      if (
        roles.length !== codes.length ||
        roles.some((r) => !codes.includes(r.code) || !r.permissions.length)
      )
        throw Error("Role matrix changed; review training provisioner");
      const existingOrg = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      if (existingOrg && existingOrg.name !== organizationName)
        throw Error("Organization collision");
      const org =
        existingOrg ||
        (await tx.organization.create({
          data: { id: organizationId, name: organizationName },
        }));
      const party = await tx.counterparty.upsert({
        where: {
          organizationId_name: { organizationId, name: "Учебный поставщик" },
        },
        update: {},
        create: { organizationId, name: "Учебный поставщик" },
      });
      const site = await tx.extractionSite.upsert({
        where: {
          organizationId_name: { organizationId, name: "Учебное место сбора" },
        },
        update: {},
        create: { organizationId, name: "Учебное место сбора" },
      });
      const material = await tx.materialType.upsert({
        where: { name: "Учебное сырьё Collection" },
        update: {},
        create: { name: "Учебное сырьё Collection" },
      });
      await tx.productType.upsert({
        where: { name: "Учебная готовая продукция Collection" },
        update: {},
        create: { name: "Учебная готовая продукция Collection" },
      });
      const warehouses = [];
      for (const [name, warehouseType] of [
        ["Учебная мойка", "RAW"],
        ["Учебный завод", "RAW"],
        ["Учебный склад готовой продукции", "FINISHED"],
      ]) {
        warehouses.push(
          await tx.warehouse.upsert({
            where: { organizationId_name: { organizationId, name } },
            update: {},
            create: {
              organizationId,
              name,
              warehouseType,
              allowedMaterialTypeIds: [material.id],
            },
          }),
        );
      }
      const plant = await tx.plant.findFirst({
        where: { organizationId, name: "Учебный завод" },
      });
      if (!plant)
        await tx.plant.create({
          data: { organizationId, name: "Учебный завод" },
        });
      const plateNumber = "COLLECTION-TRAINING-01";
      const vehicle = await tx.vehicle.findUnique({ where: { plateNumber } });
      if (
        vehicle &&
        (vehicle.organizationId !== organizationId ||
          vehicle.counterpartyId !== party.id ||
          vehicle.archivedAt)
      )
        throw Error("Vehicle collision");
      if (!vehicle)
        await tx.vehicle.create({
          data: {
            organizationId,
            counterpartyId: party.id,
            plateNumber,
            type: "TRUCK",
            brand: "Учебная машина",
            capacity: 20,
            tareWeight: 7,
          },
        });
      const result = [];
      for (const [index, code] of codes.entries()) {
        const role = roles.find((r) => r.code === code);
        const phone = "+70000000" + String(101 + index);
        let user = await tx.user.findFirst({
          where: {
            phone: { in: [phone, phone.slice(1), "8" + phone.slice(2)] },
          },
          include: { userRoles: true },
        });
        const created = !user;
        if (
          user &&
          (user.organizationId !== org.id ||
            user.phone !== phone ||
            user.isBlocked ||
            user.fullName !== "Тест — " + role.name ||
            user.userRoles.length !== 1 ||
            user.userRoles[0].roleId !== role.id)
        )
          throw Error("Existing account collision; no changes applied");
        if (!user)
          user = await tx.user.create({
            data: {
              organizationId,
              phone,
              fullName: "Тест — " + role.name,
              passwordHash,
              mustChangePassword: true,
              accessAllObjects: ["OWNER", "ADMIN"].includes(code),
              counterpartyScopeId: [
                "COLLECTOR",
                "CONTRACTOR_REP",
                "DRIVER",
              ].includes(code)
                ? party.id
                : null,
              extractionScopeIds: ["COLLECTOR", "EXTRACTION_OPERATOR"].includes(
                code,
              )
                ? [site.id]
                : [],
              warehouseScopeIds: warehouses.map((w) => w.id),
              userRoles: { create: { roleId: role.id } },
            },
          });
        if (code === "DRIVER") {
          const driver = await tx.driver.findFirst({
            where: { OR: [{ userId: user.id }, { organizationId, phone }] },
          });
          if (
            driver &&
            (driver.userId !== user.id ||
              driver.organizationId !== organizationId ||
              driver.counterpartyId !== party.id ||
              driver.archivedAt)
          )
            throw Error("Driver profile collision");
          if (!driver)
            await tx.driver.create({
              data: {
                userId: user.id,
                organizationId,
                counterpartyId: party.id,
                fullName: user.fullName,
                phone,
              },
            });
        }
        if (created)
          await tx.auditLog.create({
            data: {
              organizationId,
              userId: user.id,
              action: "user.training.create",
              entity: "User",
              entityId: user.id,
              reason:
                "User-requested isolated training account; mandatory first-login password change",
            },
          });
        result.push({
          id: user.id,
          code,
          created,
          mustChangePassword: user.mustChangePassword,
        });
      }
      return result;
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
  // Verify actual HTTP sign-in and effective role. Never print phones, passwords or tokens.
  const base = process.env.COLLECTION_TRAINING_VERIFY_API;
  if (base) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base))
      throw Error("Verification must stay on server loopback");
    for (const account of accounts.filter((a) => a.created)) {
      const phone = "+70000000" + String(101 + codes.indexOf(account.code));
      const login = await fetch(base + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: temporaryPassword }),
      });
      if (!login.ok)
        throw Error("Training login verification failed: " + account.code);
      const session = await login.json();
      try {
        const response = await fetch(base + "/auth/me", {
          headers: { Authorization: "Bearer " + session.accessToken },
        });
        if (!response.ok) throw Error("Training profile verification failed");
        const profile = await response.json();
        if (
          profile.id !== account.id ||
          profile.organization.id !== organizationId ||
          profile.roles.length !== 1 ||
          profile.roles[0] !== account.code ||
          !profile.mustChangePassword ||
          !profile.permissions.length
        )
          throw Error("Training role verification failed");
      } finally {
        // Revoke only this verification session, preserving any other sessions.
        await prisma.refreshToken.updateMany({
          where: {
            userId: account.id,
            tokenHash: require("node:crypto")
              .createHash("sha256")
              .update(session.refreshToken)
              .digest("hex"),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
    }
  }
  console.log(
    JSON.stringify({
      organization: organizationName,
      roles: accounts.map(({ code, created, mustChangePassword }) => ({
        code,
        created,
        mustChangePassword,
      })),
      loginVerified: Boolean(base) && accounts.every((a) => a.created),
      existingCredentialsPreserved: true,
    }),
  );
}
main()
  .catch(() => {
    console.error(
      "Training provisioning failed; inspect configuration without logging credentials",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
