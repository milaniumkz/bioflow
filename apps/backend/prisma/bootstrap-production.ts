import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { initializeRoles } from "./roles";
const prisma = new PrismaClient();
async function main() {
  const {
    BOOTSTRAP_ORGANIZATION_NAME: name,
    BOOTSTRAP_OWNER_EMAIL: email,
    BOOTSTRAP_OWNER_PASSWORD: password,
  } = process.env;
  if (!name || !email || !password || password.length < 16)
    throw Error(
      "Set organization name, owner email and a unique password (16+ characters) through secure environment variables",
    );
  if (await prisma.user.count())
    throw Error(
      "Bootstrap requires an empty user table; existing accounts are preserved",
    );
  const role = await initializeRoles(prisma);
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name } });
    const user = await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: "Собственник",
        passwordHash: await argon2.hash(password),
        mustChangePassword: true,
        userRoles: { create: { roleId: role.id } },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        action: "system.bootstrap",
        entity: "Organization",
        entityId: org.id,
      },
    });
  });
  console.log(
    "Production organization and owner created; no demo data imported",
  );
}
main().finally(() => prisma.$disconnect());
