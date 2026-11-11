// Protected maintenance operation, limited to the previously provisioned six accounts.
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const argon2 = backendRequire("argon2");
const definitions = [
  ["OPERATIONS_MANAGER", "priemka"],
  ["WASH_OPERATOR", "moyka"],
  ["PACKER", "upakovka"],
  ["DRIVER", "voditel"],
  ["COLLECTOR", "sborschik"],
  ["OWNER", "vladelets"],
];
function phoneCredentials(request) {
  if (
    request?.purpose !== "configure-six-work-logins-v1" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      request.id || "",
    ) ||
    !Number.isInteger(request.start) ||
    request.start < 200 ||
    request.start > 9994 ||
    typeof request.temporaryPassword !== "string" ||
    request.temporaryPassword.length < 6 ||
    request.temporaryPassword.length > 128 ||
    !/^(?:-[a-z0-9]{1,12})?$/.test(request.suffix ?? "")
  )
    throw Error("Invalid phone login request");
  return definitions.map(([code, alias], index) => ({
    code,
    email: `${alias}${request.suffix ?? ""}@collection.local`,
    phone: "+7000000" + String(request.start + index).padStart(4, "0"),
    password: request.temporaryPassword,
  }));
}
function variants(phone) {
  return [phone, phone.slice(1), "8" + phone.slice(2)];
}
async function configureAccounts(prisma, request, ownerLogin) {
  const entries = phoneCredentials(request);
  if (!ownerLogin) throw Error("Configured owner is required");
  const hashes = await Promise.all(entries.map((e) => argon2.hash(e.password)));
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: ownerLogin.startsWith("+")
          ? { phone: ownerLogin }
          : { email: ownerLogin },
      });
      if (!owner || owner.isBlocked) throw Error("Working owner unavailable");
      const ownerRole = await tx.userRole.findFirst({
        where: { userId: owner.id, role: { code: "OWNER" } },
      });
      if (!ownerRole) throw Error("Working owner role missing");
      const accounts = await tx.user.findMany({
        where: { email: { in: entries.map((e) => e.email) } },
        include: { userRoles: { include: { role: true } } },
      });
      if (accounts.length !== 6)
        throw Error("Expected the previously provisioned six accounts");
      for (const entry of entries) {
        const account = accounts.find((a) => a.email === entry.email);
        if (
          !account ||
          account.id === owner.id ||
          account.organizationId !== owner.organizationId ||
          account.isBlocked ||
          account.userRoles.length !== 1 ||
          account.userRoles[0].role.code !== entry.code
        )
          throw Error("Account identity changed; no credentials modified");
        if (account.phone && account.phone !== entry.phone)
          throw Error(
            "An account already has another phone; no existing phone replaced",
          );
      }
      const provisions = await tx.auditLog.findMany({
        where: {
          organizationId: owner.organizationId,
          action: {
            in: ["users.provision-work-roles", "users.align-work-organization"],
          },
        },
        select: { newValue: true },
      });
      if (
        !provisions.some(
          (p) =>
            Array.isArray(p.newValue?.accounts) &&
            entries.every((e) =>
              p.newValue.accounts.some(
                (a) =>
                  a.email === e.email &&
                  a.code === e.code &&
                  accounts.some((u) => u.id === a.id && u.email === e.email),
              ),
            ),
        )
      )
        throw Error("Account provenance check failed");
      const ids = accounts.map((a) => a.id),
        phones = entries.flatMap((e) => variants(e.phone));
      if (
        await tx.user.findFirst({
          where: { phone: { in: phones }, id: { notIn: ids } },
          select: { id: true },
        })
      )
        throw Error("Phone collision; no changes applied");
      const markerId = `work-phone-logins:${request.id}`;
      const marker = await tx.auditLog.findUnique({ where: { id: markerId } });
      if (marker) {
        if (
          marker.organizationId !== owner.organizationId ||
          !Array.isArray(marker.newValue?.accounts)
        )
          throw Error("Request replay mismatch");
        for (const entry of entries) {
          const account = accounts.find((a) => a.email === entry.email);
          if (
            !account.mustChangePassword ||
            account.phone !== entry.phone ||
            !marker.newValue.accounts.some(
              (a) => a.id === account.id && a.phone === entry.phone,
            ) ||
            !(await argon2.verify(account.passwordHash, entry.password))
          )
            throw Error(
              "Account changed after the request; no password reset on replay",
            );
        }
        return {
          changed: 0,
          organizationId: owner.organizationId,
          accounts: entries.map((e) => ({
            ...e,
            password: undefined,
            id: accounts.find((a) => a.email === e.email).id,
          })),
        };
      }
      for (const [index, entry] of entries.entries()) {
        const account = accounts.find((a) => a.email === entry.email);
        await tx.user.update({
          where: { id: account.id },
          data: {
            phone: entry.phone,
            passwordHash: hashes[index],
            mustChangePassword: true,
          },
        });
        await tx.refreshToken.updateMany({
          where: { userId: account.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: account.id, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      const result = entries.map((e) => ({
        code: e.code,
        email: e.email,
        phone: e.phone,
        id: accounts.find((a) => a.email === e.email).id,
      }));
      await tx.auditLog.create({
        data: {
          id: markerId,
          organizationId: owner.organizationId,
          userId: owner.id,
          action: "users.configure-work-logins",
          entity: "User",
          newValue: { accounts: result },
          reason:
            "User requested service phone logins and a shared temporary password for the six new accounts; existing accounts and contact records preserved",
        },
      });
      if (
        JSON.stringify(
          await tx.user.findUnique({ where: { id: owner.id } }),
        ) !== JSON.stringify(owner)
      )
        throw Error("Original owner preservation check failed");
      return {
        changed: 6,
        organizationId: owner.organizationId,
        accounts: result,
      };
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
async function verifyPhones(prisma, request, result, base) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base || ""))
    throw Error("Loopback verification required");
  for (const entry of phoneCredentials(request)) {
    const response = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: entry.phone, password: entry.password }),
    });
    if (!response.ok) throw Error("Phone sign-in verification failed");
    const session = await response.json();
    const account = result.accounts.find((a) => a.code === entry.code);
    try {
      const me = await fetch(base + "/auth/me", {
        headers: { Authorization: "Bearer " + session.accessToken },
      });
      if (!me.ok) throw Error("Phone profile verification failed");
      const profile = await me.json();
      if (
        profile.id !== account.id ||
        profile.organization?.id !== result.organizationId ||
        profile.phone !== entry.phone ||
        profile.roles?.length !== 1 ||
        profile.roles[0] !== entry.code ||
        !profile.mustChangePassword
      )
        throw Error("Phone role verification failed");
    } finally {
      await prisma.refreshToken.updateMany({
        where: {
          userId: account.id,
          tokenHash: createHash("sha256")
            .update(session.refreshToken)
            .digest("hex"),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }
  }
}
async function main() {
  const request = JSON.parse(
    process.env.COLLECTION_WORK_LOGIN_UPDATE_JSON || "{}",
  );
  delete process.env.COLLECTION_WORK_LOGIN_UPDATE_JSON;
  const base = process.env.COLLECTION_WORK_VERIFY_API;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base || ""))
    throw Error("Loopback verification required before changing credentials");
  const { PrismaClient } = backendRequire("@prisma/client"),
    prisma = new PrismaClient();
  try {
    const result = await configureAccounts(prisma, request, request.ownerLogin);
    await verifyPhones(prisma, request, result, base);
    console.log(
      JSON.stringify({
        changed: result.changed,
        verifiedPhoneSignIns: 6,
        existingOtherAccountsPreserved: true,
        mandatoryPasswordChange: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
module.exports = { phoneCredentials, configureAccounts, verifyPhones };
if (process.env.COLLECTION_WORK_LOGIN_UPDATE_JSON)
  main().catch(() => {
    console.error(
      "Work phone login operation failed. Other accounts were not modified. Review the protected operation without logging its encrypted request or temporary password.",
    );
    process.exitCode = 1;
  });
