import { OwnerDashboard } from "./owner-dashboard";
import {
  validDeliveryTransition,
  CustomerDeliveryService,
} from "./customer-delivery";
import { CurrentUser } from "../common/current-user.decorator";
const date = new Date("2026-11-09T12:00:00Z");
const user = {
  id: "owner",
  organizationId: "org",
  accessAllObjects: true,
  permissions: ["processing.sell"],
} as CurrentUser;
function fixture() {
  const batch = {
    id: "root",
    number: "B-1",
    createdById: "collector",
    measuredAt: new Date("2026-10-01"),
    initialQuantity: 10,
    availableSourceQuantity: 2,
    actualBagCount: 10,
    counterpartyId: "party",
    extractionSiteId: "site",
    status: "CONFIRMED",
    stocks: [
      {
        id: "stock",
        warehouseId: "wash",
        quantity: 2,
        reserved: 1,
        updatedAt: date,
      },
    ],
    laboratoryAnalyses: [
      {
        id: "lab",
        createdById: "analyst",
        measuredAt: date,
        actualQuantity: 9,
        actualBagCount: 9,
        moisturePercent: 10,
        sedimentPercent: 5,
      },
    ],
    waybills: [
      {
        id: "trip",
        number: "T-1",
        createdById: "collector",
        createdAt: date,
        status: "IN_TRANSIT",
        driverId: "driver",
        driver: { id: "driver", fullName: "Driver" },
        vehicle: { plateNumber: "001" },
        destinationWarehouseId: "wash",
        declaredWeight: 8,
        receivedWeight: null,
        bagCount: 8,
        routeStops: [
          {
            id: "stop",
            startedAt: date,
            lastObservedAt: new Date(date.getTime() + 600000),
          },
        ],
      },
    ],
    bigBag: null,
  };
  const prisma: any = {
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    materialBatch: { findMany: jest.fn().mockResolvedValue([batch]) },
    processRun: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "run",
          rootBatchId: "root",
          kind: "WASHING",
          number: "R-1",
          createdAt: date,
          createdById: "washer",
          fromWarehouseId: "wash",
          toWarehouseId: "plant",
          inputQuantity: 8,
          outputQuantity: 6,
          coefficientPercent: 25,
          normMinPercent: 10,
          normMaxPercent: 20,
          deviation: "ABOVE",
          inputs: [],
          bags: [
            {
              id: "bag",
              batchId: "washed",
              ordinal: 1,
              quantity: 6,
              stage: "WASHED",
              soldAt: date,
              soldById: "seller",
              saleRecipient: "Buyer",
            },
          ],
        },
      ]),
    },
    warehouse: {
      findMany: jest.fn().mockResolvedValue([
        { id: "wash", name: "Wash" },
        { id: "plant", name: "Plant" },
      ]),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: "analyst", fullName: "Analyst" }]),
    },
    batchOperation: { findMany: jest.fn().mockResolvedValue([]) },
    customerDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    driver: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: "driver", fullName: "Driver" }]),
    },
  };
  return { prisma, service: new OwnerDashboard(prisma) };
}
test("event period includes laboratory and processing of an older source batch", async () => {
  const { service } = fixture();
  const d = await service.read(
    { dateFrom: "2026-11-09", dateTo: "2026-11-09" },
    user,
  );
  expect(d.groups.collection.records).toHaveLength(0);
  expect(d.groups.laboratory.quantity).toBe(9);
  expect(d.groups.washing.quantity).toBe(6);
  expect(d.groups.losses.quantity).toBe(2);
  expect(d.groups.deviations.records).toHaveLength(1);
  expect(d.groups.idle.records).toHaveLength(1);
  expect(d.groups.idle.idleMinutes).toBe(10);
  expect(d.groups.transport.drivers).toBe(1);
  expect(d.groups.transport.inTransitCount).toBe(1);
  expect(d.groups.delivery.records[0].status).toBe("Доставка не запланирована");
});
test("combined driver warehouse employee filters follow lineage and event employee", async () => {
  const { service } = fixture();
  const d = await service.read(
    { driverId: "driver", warehouseId: "wash", employeeId: "washer" },
    user,
  );
  expect(d.groups.washing.quantity).toBe(6);
  expect(d.groups.transport.records).toHaveLength(0);
  expect(d.groups.laboratory.records).toHaveLength(0);
  const empty = await service.read({ driverId: "other" }, user);
  expect(Object.values(empty.groups).every((g) => g.records.length === 0)).toBe(
    true,
  );
});
test("organization and object scope stay in database queries; invalid periods fail", async () => {
  const { prisma, service } = fixture();
  await service.read(
    {},
    { ...user, accessAllObjects: false, warehouseScopeIds: ["wash"] },
  );
  expect(prisma.materialBatch.findMany.mock.calls[0][0].where).toMatchObject({
    organizationId: "org",
    AND: [{ stocks: { some: { warehouseId: { in: ["wash"] } } } }],
  });
  expect(
    prisma.batchOperation.findMany.mock.calls[0][0].where.inputs.every,
  ).toBeDefined();
  await expect(
    service.read({ dateFrom: "2026-11-10", dateTo: "2026-11-09" }, user),
  ).rejects.toThrow();
});
test("delivery cannot skip dispatch or rewrite delivered history", () => {
  expect(validDeliveryTransition(undefined, "DELIVERED")).toBe(false);
  expect(validDeliveryTransition(undefined, "PLANNED")).toBe(true);
  expect(validDeliveryTransition("PLANNED", "DELIVERED")).toBe(false);
  expect(validDeliveryTransition("PLANNED", "IN_TRANSIT")).toBe(true);
  expect(validDeliveryTransition("IN_TRANSIT", "DELIVERED")).toBe(true);
  expect(validDeliveryTransition("DELIVERED", "PLANNED")).toBe(false);
});
test("delivery rejects a missing sale and does not mutate stocks", async () => {
  const tx = {
    bigBag: { findFirst: jest.fn().mockResolvedValue(null) },
    batchOperation: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new CustomerDeliveryService({
    $transaction: async (fn: any) => fn(tx),
  } as any);
  await expect(
    service.save(
      {
        sourceId: "foreign",
        destination: "Buyer",
        route: "A → B",
        status: "PLANNED",
        version: 0,
      },
      user,
    ),
  ).rejects.toThrow("Отпуск покупателю не найден");
});

test("delivery period and assigned driver use delivery event rather than sale date", async () => {
  const { prisma, service } = fixture();
  const runs = await prisma.processRun.findMany();
  runs[0].bags[0].soldAt = new Date("2026-10-01");
  prisma.customerDelivery.findMany.mockResolvedValue([
    {
      id: "delivery",
      sourceId: "bag",
      driverId: "delivery-driver",
      status: "DELIVERED",
      updatedAt: date,
      route: "A → B",
      destination: "Buyer",
      events: [{ createdById: "dispatcher", createdAt: date }],
    },
  ]);
  const d = await service.read(
    {
      dateFrom: "2026-11-09",
      dateTo: "2026-11-09",
      driverId: "delivery-driver",
      employeeId: "dispatcher",
    },
    user,
  );
  expect(d.groups.sales.records).toHaveLength(0);
  expect(d.groups.delivery.records).toHaveLength(1);
  expect(d.groups.delivery.records[0].status).toBe("DELIVERED");
});

test("delivery appends a snapshot with optimistic version checks and leaves sale inventory alone", async () => {
  const old = { id: "delivery", version: 1, status: "PLANNED" };
  const tx = {
    bigBag: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          id: "sale",
          stage: "DRIED",
          batch: { stocks: [] },
        }),
    },
    driver: { findFirst: jest.fn().mockResolvedValue({ id: "driver" }) },
    customerDelivery: {
      findUnique: jest.fn().mockResolvedValue(old),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...old, version: 2, status: "IN_TRANSIT" }),
    },
    customerDeliveryEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const service = new CustomerDeliveryService({
    $transaction: async (fn: any) => fn(tx),
  } as any);
  const dto = {
    sourceId: "sale",
    destination: "Buyer",
    route: "A → B",
    status: "IN_TRANSIT",
    version: 1,
    driverId: "driver",
    notes: "Departed",
  };
  const result = await service.save(dto, user);
  expect(result.version).toBe(2);
  expect(tx.customerDeliveryEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      deliveryId: "delivery",
      status: "IN_TRANSIT",
      createdById: "owner",
      notes: "Departed",
    }),
  });
  tx.customerDelivery.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.save(dto, user)).rejects.toThrow(
    "Доставка уже изменена",
  );
  expect(tx.customerDeliveryEvent.create).toHaveBeenCalledTimes(1);
  await expect(service.save({ ...dto, version: 0 }, user)).rejects.toThrow(
    "Доставка изменена",
  );
});

test("prewash output is not counted a second time as washing throughput; returns reduce net sales", async () => {
  const { prisma, service } = fixture();
  const runs = await prisma.processRun.findMany();
  runs.push({
    ...runs[0],
    id: "prepare",
    kind: "PREWASH",
    bags: [],
    inputQuantity: 10,
    outputQuantity: 8,
  });
  prisma.batchOperation.findMany.mockResolvedValue(
    ["SHIPMENT", "RETURN"].map((kind, i) => ({
      id: kind,
      number: kind,
      kind,
      createdAt: date,
      confirmedAt: date,
      createdById: "seller",
      fromWarehouseId: "wash",
      toWarehouseId: null,
      inputs: [{ batchId: "root", quantity: i ? 1 : 3 }],
      outputQuantity: 0,
      lossQuantity: 0,
      wasteQuantity: 0,
      defectQuantity: 0,
    })),
  );
  const d = await service.read({}, user);
  expect(d.groups.washing.quantity).toBe(6);
  expect(d.groups.washing.records).toHaveLength(1);
  expect(d.groups.losses.quantity).toBe(4);
  expect(d.groups.sales.quantity).toBe(8);
  expect(d.groups.delivery.records).toHaveLength(2);
});
