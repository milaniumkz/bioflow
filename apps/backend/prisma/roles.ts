import { PrismaClient } from "@prisma/client";
export async function initializeRoles(prisma: PrismaClient) {
  const permissionCodes = [
    "batches.manage",
    "loading.manage",
    "inventory.manage",
    "references.read",
    "dashboard.read",
    "references.manage",
    "waybills.manage",
    "waybills.accept",
    "inventory.read",
    "operations.manage",
    "reports.read",
    "notifications.read",
    "audit.read",
    "users.manage",
  ];
  for (const code of permissionCodes) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
  }

  const roleMatrix: Record<string, { name: string; permissions: string[] }> = {
    OWNER: { name: "Владелец", permissions: permissionCodes },
    ADMIN: {
      name: "Администратор",
      permissions: [
        "references.read",
        "dashboard.read",
        "references.manage",
        "users.manage",
        "inventory.read",
        "notifications.read",
        "audit.read",
      ],
    },
    CONTRACTOR_REP: {
      name: "Представитель контрагента",
      permissions: [
        "waybills.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    RECEIVER: {
      name: "Кладовщик/приёмщик",
      permissions: [
        "waybills.accept",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    WASH_OPERATOR: {
      name: "Оператор мойки",
      permissions: [
        "operations.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    PRODUCTION_OPERATOR: {
      name: "Оператор производства",
      permissions: [
        "operations.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    DISPATCHER: {
      name: "Диспетчер/логист",
      permissions: [
        "waybills.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    EXTRACTION_OPERATOR: {
      name: "Оператор добычи",
      permissions: [
        "batches.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    LOADING_OPERATOR: {
      name: "Весовщик/оператор погрузки",
      permissions: [
        "loading.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    WAREHOUSE_OPERATOR: {
      name: "Кладовщик",
      permissions: [
        "inventory.manage",
        "inventory.read",
        "references.read",
        "notifications.read",
      ],
    },
    AUDITOR: {
      name: "Наблюдатель/аудитор",
      permissions: [
        "references.read",
        "dashboard.read",
        "inventory.read",
        "reports.read",
        "notifications.read",
        "audit.read",
      ],
    },
  };

  let owner = await prisma.role.upsert({
    where: { code: "OWNER" },
    update: { name: roleMatrix.OWNER.name },
    create: { code: "OWNER", name: roleMatrix.OWNER.name },
  });
  const permissions = await prisma.permission.findMany();
  for (const [code, roleDef] of Object.entries(roleMatrix)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: roleDef.name },
      create: { code, name: roleDef.name },
    });
    if (code === "OWNER") owner = role;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permission of permissions.filter((item) =>
      roleDef.permissions.includes(item.code),
    )) {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  return owner;
}
