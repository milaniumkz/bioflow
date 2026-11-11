import { PrismaClient } from "@prisma/client";
import { assertCollectionDatabase } from "./collection-database";
export async function bootstrapCollection(db: PrismaClient) {
  assertCollectionDatabase();
  const organizationId =
    process.env.COLLECTION_ORGANIZATION_ID ?? "collection-live";
  const org = await db.organization.upsert({
    where: { id: organizationId },
    update: {},
    create: {
      id: organizationId,
      name: process.env.COLLECTION_ORGANIZATION_NAME ?? "Collection",
    },
  });
  for (const [code, name] of [
    ["HELIOS", "Гелиос"],
    ["ZHANA_AUL", "Жана-аул"],
    ["EKIBASTUZ", "Экибастуз"],
    ["TEC3", "ТЭЦ-3"],
  ]) {
    await db.collectionLocation.upsert({
      where: { organizationId_code: { organizationId: org.id, code } },
      update: {},
      create: { organizationId: org.id, code, name, kind: "WAREHOUSE" },
    });
  }
  const permission = await db.permission.upsert({
    where: { code: "notifications.read" },
    update: {},
    create: { code: "notifications.read", name: "Уведомления" },
  });
  for (const [code, name] of [
    ["OWNER", "Владелец"],
    ["COLLECTOR", "Сборщик"],
    ["WAREHOUSE_MANAGER", "Ответственный склада"],
    ["FACTORY_MANAGER", "Ответственный завода"],
  ]) {
    const role = await db.role.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    await db.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
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
