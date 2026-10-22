// Runs only inside the backend through the protected account workflow.
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient } = backendRequire("@prisma/client");
const argon2 = backendRequire("argon2");
const prisma = new PrismaClient();
(async () => {
  const { phone, temporaryPassword } = JSON.parse(
    process.env.BIOFLOW_OWNER_RESET_JSON || "{}",
  );
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const operation = process.env.BIOFLOW_ACCOUNT_OPERATION_ID;
  if (
    !email ||
    !/^\+[1-9]\d{6,14}$/.test(phone || "") ||
    typeof temporaryPassword !== "string" ||
    temporaryPassword.length < 6 ||
    temporaryPassword.length > 128 ||
    !/^\d{1,30}$/.test(operation || "")
  ) {
    throw Error("Invalid reset request");
  }
  const reason = `Owner requested temporary password; operation ${operation}`;
  const hash = await argon2.hash(temporaryPassword);
  const changed = await prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { email },
        include: { userRoles: { include: { role: true } } },
      });
      if (
        !owner ||
        owner.isBlocked ||
        owner.phone !== phone ||
        !owner.userRoles.some((x) => x.role.code === "OWNER")
      ) {
        throw Error("Owner identity does not match");
      }
      if (
        await tx.auditLog.findFirst({
          where: { userId: owner.id, action: "auth.owner-reset", reason },
        })
      )
        return false;
      await tx.user.update({
        where: { id: owner.id },
        data: {
          passwordHash: hash,
          mustChangePassword: true,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: owner.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: owner.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: owner.organizationId,
          userId: owner.id,
          action: "auth.owner-reset",
          entity: "User",
          entityId: owner.id,
          reason,
        },
      });
      return true;
    },
    { isolationLevel: "Serializable" },
  );
  console.log(
    changed
      ? "Owner temporary password set; mandatory change enabled; previous sessions and reset links revoked"
      : "Owner reset operation already applied; no credentials changed again",
  );
})()
  .catch(() => {
    console.error(
      "Owner reset failed; check identity/configuration without logging credentials",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
