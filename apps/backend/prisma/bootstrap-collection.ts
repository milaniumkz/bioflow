import { PrismaClient } from "@prisma/client";
import { assertCollectionDatabase } from "./collection-database";
export async function bootstrapCollection(db: PrismaClient) {
  assertCollectionDatabase();
  const organizationId =
    process.env.COLLECTION_ORGANIZATION_ID ?? "collection-live";
  await db.organization.createMany({
    data: [
      {
        id: organizationId,
        name: process.env.COLLECTION_ORGANIZATION_NAME ?? "Collection",
      },
    ],
    skipDuplicates: true,
  });
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  for (const [code, name] of [
    ["HELIOS", "Гелиос"],
    ["ZHANA_AUL", "Жана-аул"],
    ["EKIBASTUZ", "Экибастуз"],
    ["TEC3", "ТЭЦ-3"],
  ]) {
    await db.collectionLocation.createMany({
      data: [{ organizationId: org.id, code, name, kind: "WAREHOUSE" }],
      skipDuplicates: true,
    });
  }
  for (const [code, name] of [
    ["FACTORY-ZHANA_AUL", "Жана-аул"],
    ["FACTORY-SEZ", "СЭЗ"],
  ]) {
    await db.collectionLocation.createMany({
      data: [{ organizationId: org.id, code, name, kind: "FACTORY" }],
      skipDuplicates: true,
    });
  }
  await db.permission.createMany({
    data: [{ code: "notifications.read", name: "Уведомления" }],
    skipDuplicates: true,
  });
  const permission = await db.permission.findUniqueOrThrow({
    where: { code: "notifications.read" },
  });
  for (const [code, name] of [
    ["OWNER", "Владелец"],
    ["ADMIN", "Администратор"],
    ["COLLECTOR", "Сборщик"],
    ["WAREHOUSE_MANAGER", "Ответственный склада"],
    ["FACTORY_MANAGER", "Ответственный завода"],
  ]) {
    const role = await db.role.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    await db.rolePermission.createMany({
      data: [{ roleId: role.id, permissionId: permission.id }],
      skipDuplicates: true,
    });
  }
  // User accounts and passwords are intentionally not created.
  return org;
}
if (require.main === module) {
  const db = new PrismaClient();
  bootstrapCollection(db)
    .then((org) =>
      console.log(
        `Collection initialized: ${org.id}; no user accounts created`,
      ),
    )
    .finally(() => db.$disconnect());
}
