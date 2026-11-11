// Protected account workflow: create six sign-ins in the configured owner's company.
// No seed, account adoption, password reset or operational record changes.
const { createRequire } = require("node:module");
const { createHash, createHmac } = require("node:crypto");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const argon2 = backendRequire("argon2");
const definitions = [
  ["OPERATIONS_MANAGER", "priemka", true],
  ["WASH_OPERATOR", "moyka", true],
  ["PACKER", "upakovka", false],
  ["DRIVER", "voditel", false],
  ["COLLECTOR", "sborschik", true],
  ["OWNER", "vladelets", true],
];
function validate(request) {
  if (
    request?.purpose !== "create-six-work-accounts-v1" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      request.id || "",
    ) ||
    !/^[A-Za-z0-9_-]{43}$/.test(request.seed || "") ||
    Buffer.from(request.seed, "base64url").length !== 32 ||
    !/^(?:-[a-z0-9]{1,12})?$/.test(request.suffix ?? "")
  )
    throw Error("Invalid work-account request");
}
function credentials(request) {
  validate(request);
  return definitions.map(([code, alias]) => ({
    code,
    email: `${alias}${request.suffix ?? ""}@collection.local`,
    password:
      createHmac("sha256", Buffer.from(request.seed, "base64url"))
        .update(`collection-work-account/v1:${request.id}:${code}`)
        .digest("base64url")
        .slice(0, 14) + "7a!",
  }));
}
async function createAccounts(prisma, request, ownerLogin) {
  validate(request);
  if (!ownerLogin) throw Error("Configured owner is required");
  const entries = credentials(request);
  const hashes = await Promise.all(entries.map((e) => argon2.hash(e.password)));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        purpose: request.purpose,
        id: request.id,
        seed: request.seed,
        suffix: request.suffix ?? "",
      }),
    )
    .digest("hex");
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: ownerLogin.startsWith("+")
          ? { phone: ownerLogin }
          : { email: ownerLogin },
        include: { userRoles: { include: { role: true } } },
      });
      if (
        !owner ||
        owner.isBlocked ||
        !owner.userRoles.some((r) => r.role.code === "OWNER")
      )
        throw Error("Working organization owner not found");
      const roles = await tx.role.findMany({
        where: { code: { in: definitions.map((d) => d[0]) } },
        include: { permissions: true },
      });
      if (roles.length !== 6 || roles.some((r) => !r.permissions.length))
        throw Error("Six working roles must already be installed");
      const existing = await tx.user.findMany({
        where: { email: { in: entries.map((e) => e.email) } },
        include: { userRoles: true },
      });
      const markerId = `work-signins:${request.id}`;
      const marker = await tx.auditLog.findUnique({ where: { id: markerId } });
      if (marker) {
        const recorded = marker.newValue;
        if (
          marker.organizationId !== owner.organizationId ||
          recorded?.fingerprint !== fingerprint ||
          !Array.isArray(recorded.accounts) ||
          existing.length !== 6
        )
          throw Error("Request replay does not match the existing batch");
        for (const entry of entries) {
          const role = roles.find((r) => r.code === entry.code),
            account = existing.find((u) => u.email === entry.email);
          if (
            !account ||
            account.organizationId !== owner.organizationId ||
            account.isBlocked ||
            !account.mustChangePassword ||
            account.userRoles.length !== 1 ||
            account.userRoles[0].roleId !== role.id ||
            !recorded.accounts.some(
              (a) => a.id === account.id && a.code === entry.code,
            )
          )
            throw Error("Existing account changed; credentials were preserved");
        }
        return {
          organizationId: owner.organizationId,
          created: 0,
          accounts: recorded.accounts,
        };
      }
      if (existing.length)
        throw Error("Account collision; no existing account may be replaced");
      const [warehouses, sites] = await Promise.all([
        tx.warehouse.findMany({
          where: { organizationId: owner.organizationId, archivedAt: null },
          select: { id: true },
        }),
        tx.extractionSite.findMany({
          where: { organizationId: owner.organizationId, archivedAt: null },
          select: { id: true },
        }),
      ]);
      const accounts = [];
      for (const [index, entry] of entries.entries()) {
        const role = roles.find((r) => r.code === entry.code);
        const account = await tx.user.create({
          data: {
            organizationId: owner.organizationId,
            email: entry.email,
            fullName: `${role.name} — рабочий вход`,
            passwordHash: hashes[index],
            mustChangePassword: true,
            accessAllObjects: definitions[index][2],
            counterpartyScopeId: null,
            warehouseScopeIds:
              entry.code === "DRIVER" ? [] : warehouses.map((w) => w.id),
            extractionScopeIds:
              entry.code === "COLLECTOR" ? sites.map((s) => s.id) : [],
            userRoles: { create: { roleId: role.id } },
          },
        });
        if (entry.code === "DRIVER")
          await tx.driver.create({
            data: {
              organizationId: owner.organizationId,
              userId: account.id,
              fullName: account.fullName,
            },
          });
        accounts.push({ code: entry.code, email: entry.email, id: account.id });
      }
      await tx.auditLog.create({
        data: {
          id: markerId,
          organizationId: owner.organizationId,
          userId: owner.id,
          action: "users.provision-work-roles",
          entity: "User",
          newValue: { fingerprint, accounts },
          reason:
            "Owner requested six working sign-ins; existing accounts and operational records preserved",
        },
      });
      const after = await tx.user.findUnique({
        where: { id: owner.id },
        include: { userRoles: { include: { role: true } } },
      });
      const snapshot = (u) => ({
        ...u,
        userRoles: [...u.userRoles].sort((a, b) =>
          a.roleId.localeCompare(b.roleId),
        ),
      });
      if (JSON.stringify(snapshot(after)) !== JSON.stringify(snapshot(owner)))
        throw Error("Original owner preservation check failed");
      return { organizationId: owner.organizationId, created: 6, accounts };
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
async function verifyAccounts(prisma, request, result, base) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base || ""))
    throw Error("Account verification requires server loopback");
  for (const entry of credentials(request)) {
    const account = result.accounts.find((a) => a.code === entry.code);
    const response = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: entry.email, password: entry.password }),
    });
    if (!response.ok) throw Error("New sign-in verification failed");
    const session = await response.json();
    try {
      const me = await fetch(base + "/auth/me", {
        headers: { Authorization: "Bearer " + session.accessToken },
      });
      if (!me.ok) throw Error("New profile verification failed");
      const profile = await me.json();
      if (
        profile.id !== account.id ||
        profile.organization?.id !== result.organizationId ||
        profile.roles?.length !== 1 ||
        profile.roles[0] !== entry.code ||
        !profile.mustChangePassword ||
        !profile.permissions?.length
      )
        throw Error("New role or first-login policy verification failed");
      if (
        entry.code === "DRIVER" &&
        !(await prisma.driver.findUnique({ where: { userId: account.id } }))
      )
        throw Error("Driver profile missing");
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
  const request = JSON.parse(process.env.COLLECTION_WORK_ACCOUNTS_JSON || "{}");
  delete process.env.COLLECTION_WORK_ACCOUNTS_JSON;
  const base = process.env.COLLECTION_WORK_VERIFY_API;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base || ""))
    throw Error("Loopback verification is required before creating accounts");
  const { PrismaClient } = backendRequire("@prisma/client"),
    prisma = new PrismaClient();
  try {
    const result = await createAccounts(prisma, request, request.ownerLogin);
    await verifyAccounts(prisma, request, result, base);
    console.log(
      JSON.stringify({
        created: result.created,
        verifiedSignIns: 6,
        workingOrganization: true,
        existingAccountsPreserved: true,
        mandatoryPasswordChange: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
module.exports = { createAccounts, credentials, verifyAccounts };
if (process.env.COLLECTION_WORK_ACCOUNTS_JSON)
  main().catch(() => {
    console.error(
      "Work sign-in provisioning failed. Existing accounts were never overwritten. Retry the same encrypted request after reviewing the protected operation; do not log its contents.",
    );
    process.exitCode = 1;
  });
