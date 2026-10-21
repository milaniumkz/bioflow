// Executed only inside the deployed backend by the protected account workflow.
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient } = backendRequire("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const phone = process.env.BIOFLOW_OWNER_PHONE;
  if (!email || !/^\+[1-9]\d{6,14}$/.test(phone || ""))
    throw Error("Invalid owner account configuration");
  await prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { email },
        include: { userRoles: { include: { role: true } } },
      });
      if (
        !owner ||
        owner.isBlocked ||
        !owner.userRoles.some((x) => x.role.code === "OWNER")
      )
        throw Error("Configured owner not found or blocked");
      const variants = [
        phone,
        phone.slice(1),
        ...(phone.startsWith("+7") ? ["8" + phone.slice(2)] : []),
      ];
      const conflict = await tx.user.findFirst({
        where: { phone: { in: variants }, id: { not: owner.id } },
      });
      if (conflict)
        throw Error("Phone belongs to another account; no changes made");
      if (owner.phone && owner.phone !== phone)
        throw Error("Owner already has a different phone; no changes made");
      if (owner.phone === phone) return;
      await tx.user.update({ where: { id: owner.id }, data: { phone } });
      await tx.auditLog.create({
        data: {
          organizationId: owner.organizationId,
          userId: owner.id,
          action: "user.phone.bind",
          entity: "User",
          entityId: owner.id,
          reason:
            "Owner requested phone sign-in; password and permissions preserved",
        },
      });
      const after = await tx.user.findUniqueOrThrow({
        where: { id: owner.id },
      });
      if (
        after.phone !== phone ||
        after.passwordHash !== owner.passwordHash ||
        after.mustChangePassword !== owner.mustChangePassword
      )
        throw Error("Owner preservation check failed");
    },
    { isolationLevel: "Serializable" },
  );
  console.log(
    "Owner phone verified; password, roles and business data preserved",
  );
})()
  .catch(() => {
    console.error(
      "Owner phone binding failed; transaction rolled back. Check collision/configuration without logging private data.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
