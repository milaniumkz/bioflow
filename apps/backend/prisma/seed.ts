import { PrismaClient } from "@prisma/client";
import { initializeRoles } from "./roles";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Demo seed is forbidden in production; use the production bootstrap",
    );
  const org = await prisma.organization.upsert({
    where: { bin: "000000000000" },
    update: {},
    create: { name: "BIOFLOW Demo", bin: "000000000000" },
  });

  const owner = await initializeRoles(prisma);

  const user = await prisma.user.upsert({
    where: { email: "owner@bioflow.local" },
    update: {},
    create: {
      organizationId: org.id,
      email: "owner@bioflow.local",
      phone: "+77000000000",
      fullName: "Demo Owner",
      passwordHash: await argon2.hash("Bioflow123!"),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: owner.id } },
    update: {},
    create: { userId: user.id, roleId: owner.id },
  });

  const material = await prisma.materialType.upsert({
    where: { name: "Биоматериал" },
    update: {},
    create: { name: "Биоматериал" },
  });
  await prisma.productType.upsert({
    where: { name: "Готовая продукция" },
    update: {},
    create: { name: "Готовая продукция" },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: "Основной склад" },
    },
    update: { address: "Алматы" },
    create: {
      organizationId: org.id,
      name: "Основной склад",
      address: "Алматы",
    },
  });
  const counterparty = await prisma.counterparty.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: "Контрагент Demo" },
    },
    update: { bin: "111111111111", status: "ACTIVE" },
    create: {
      organizationId: org.id,
      name: "Контрагент Demo",
      bin: "111111111111",
      status: "ACTIVE",
    },
  });
  await prisma.vehicle.upsert({
    where: { plateNumber: "001AAA02" },
    update: {
      organizationId: org.id,
      counterpartyId: counterparty.id,
      type: "Грузовой",
      brand: "MAN",
      status: "ACTIVE",
    },
    create: {
      organizationId: org.id,
      counterpartyId: counterparty.id,
      type: "Грузовой",
      brand: "MAN",
      plateNumber: "001AAA02",
    },
  });
  await prisma.driver.upsert({
    where: {
      organizationId_phone: { organizationId: org.id, phone: "+77001112233" },
    },
    update: { counterpartyId: counterparty.id, fullName: "Иван Петров" },
    create: {
      organizationId: org.id,
      counterpartyId: counterparty.id,
      fullName: "Иван Петров",
      phone: "+77001112233",
    },
  });
  await prisma.extractionSite.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: "Озеро Demo" },
    },
    update: { location: "Алматинская область" },
    create: {
      organizationId: org.id,
      name: "Озеро Demo",
      location: "Алматинская область",
    },
  });

  await prisma.inventoryItem.upsert({
    where: { skuKey: `${warehouse.id}:${material.id}:DIRTY` },
    update: {},
    create: {
      skuKey: `${warehouse.id}:${material.id}:DIRTY`,
      warehouseId: warehouse.id,
      materialTypeId: material.id,
      state: "DIRTY",
      quantity: "0",
    },
  });

  await prisma.systemSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: org.id,
        key: "acceptance.differenceThresholdPercent",
      },
    },
    update: { value: 3 },
    create: {
      organizationId: org.id,
      key: "acceptance.differenceThresholdPercent",
      value: 3,
    },
  });
}

main().finally(() => prisma.$disconnect());
