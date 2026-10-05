import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { bin: "000000000000" },
    update: {},
    create: { name: "BIOFLOW Demo", bin: "000000000000" }
  });

  const permissionCodes = [
    "dashboard.read",
    "references.manage",
    "waybills.manage",
    "waybills.accept",
    "inventory.read",
    "operations.manage",
    "reports.read",
    "notifications.read",
    "audit.read",
    "users.manage"
  ];
  for (const code of permissionCodes) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  }

  const roleMatrix: Record<string, { name: string; permissions: string[] }> = {
    OWNER: { name: "Владелец", permissions: permissionCodes },
    ADMIN: { name: "Администратор", permissions: ["dashboard.read", "references.manage", "users.manage", "inventory.read", "notifications.read", "audit.read"] },
    CONTRACTOR_REP: { name: "Представитель контрагента", permissions: ["waybills.manage", "inventory.read", "notifications.read"] },
    RECEIVER: { name: "Кладовщик/приёмщик", permissions: ["waybills.accept", "inventory.read", "notifications.read"] },
    WASH_OPERATOR: { name: "Оператор мойки", permissions: ["operations.manage", "inventory.read", "notifications.read"] },
    PRODUCTION_OPERATOR: { name: "Оператор производства", permissions: ["operations.manage", "inventory.read", "notifications.read"] },
    AUDITOR: { name: "Наблюдатель/аудитор", permissions: ["dashboard.read", "inventory.read", "reports.read", "notifications.read", "audit.read"] }
  };

  let owner = await prisma.role.upsert({
    where: { code: "OWNER" },
    update: { name: roleMatrix.OWNER.name },
    create: { code: "OWNER", name: roleMatrix.OWNER.name }
  });
  const permissions = await prisma.permission.findMany();
  for (const [code, roleDef] of Object.entries(roleMatrix)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: roleDef.name },
      create: { code, name: roleDef.name }
    });
    if (code === "OWNER") owner = role;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permission of permissions.filter((item) => roleDef.permissions.includes(item.code))) {
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
  }

  const user = await prisma.user.upsert({
    where: { email: "owner@bioflow.local" },
    update: {},
    create: {
      organizationId: org.id,
      email: "owner@bioflow.local",
      phone: "+77000000000",
      fullName: "Demo Owner",
      passwordHash: await argon2.hash("Bioflow123!")
    }
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: owner.id } },
    update: {},
    create: { userId: user.id, roleId: owner.id }
  });

  const material = await prisma.materialType.upsert({
    where: { name: "Биоматериал" },
    update: {},
    create: { name: "Биоматериал" }
  });
  await prisma.productType.upsert({ where: { name: "Готовая продукция" }, update: {}, create: { name: "Готовая продукция" } });
  const warehouse = await prisma.warehouse.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Основной склад" } },
    update: { address: "Алматы" },
    create: { organizationId: org.id, name: "Основной склад", address: "Алматы" }
  });
  const counterparty = await prisma.counterparty.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Контрагент Demo" } },
    update: { bin: "111111111111", status: "ACTIVE" },
    create: { organizationId: org.id, name: "Контрагент Demo", bin: "111111111111", status: "ACTIVE" }
  });
  await prisma.vehicle.upsert({
    where: { plateNumber: "001AAA02" },
    update: { organizationId: org.id, counterpartyId: counterparty.id, type: "Грузовой", brand: "MAN", status: "ACTIVE" },
    create: { organizationId: org.id, counterpartyId: counterparty.id, type: "Грузовой", brand: "MAN", plateNumber: "001AAA02" }
  });
  await prisma.driver.upsert({
    where: { organizationId_phone: { organizationId: org.id, phone: "+77001112233" } },
    update: { counterpartyId: counterparty.id, fullName: "Иван Петров" },
    create: { organizationId: org.id, counterpartyId: counterparty.id, fullName: "Иван Петров", phone: "+77001112233" }
  });
  await prisma.extractionSite.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Озеро Demo" } },
    update: { location: "Алматинская область" },
    create: { organizationId: org.id, name: "Озеро Demo", location: "Алматинская область" }
  });

  await prisma.inventoryItem.upsert({
    where: { skuKey: `${warehouse.id}:${material.id}:DIRTY` },
    update: {},
    create: { skuKey: `${warehouse.id}:${material.id}:DIRTY`, warehouseId: warehouse.id, materialTypeId: material.id, state: "DIRTY", quantity: "0" }
  });

  await prisma.systemSetting.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "acceptance.differenceThresholdPercent" } },
    update: { value: 3 },
    create: { organizationId: org.id, key: "acceptance.differenceThresholdPercent", value: 3 }
  });
}

main().finally(() => prisma.$disconnect());
