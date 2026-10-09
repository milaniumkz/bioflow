import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV !== "test" || !database.pathname.endsWith("_spec")) {
    throw new Error(
      "UI fixtures require NODE_ENV=test and an isolated *_spec database",
    );
  }
  const prisma = new PrismaClient();
  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { bin: "000000000000" },
    });
    const roles = await prisma.role.findMany();
    const passwordHash = await argon2.hash("IntegrationOnly2026!");
    for (const role of roles) {
      const user = await prisma.user.upsert({
        where: { email: `android-${role.code.toLowerCase()}@uat.local` },
        update: {
          passwordHash,
          mustChangePassword: false,
          accessAllObjects: true,
        },
        create: {
          organizationId: organization.id,
          email: `android-${role.code.toLowerCase()}@uat.local`,
          fullName: `UI ${role.code}`,
          passwordHash,
          mustChangePassword: false,
          accessAllObjects: true,
        },
      });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
    await prisma.notification.create({
      data: {
        organizationId: organization.id,
        type: "SYSTEM",
        title: "Проверка интерфейса",
        body: "Только изолированный стенд",
      },
    });
    console.log(`Prepared ${roles.length} roles on an isolated UI database`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
