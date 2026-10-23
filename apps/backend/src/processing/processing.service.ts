import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import * as QRCode from "qrcode";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { LedgerService } from "../ledger/ledger.service";
import { mass } from "../ledger/ledger-policy";
import { nextDocumentNumber } from "../common/document-numbers";
import {
  BagReceiptDto,
  LaboratoryDto,
  PackDto,
  ProcessDto,
  ProcessingRegistryDto,
  ReceiveCollectionDto,
  SellDto,
} from "./processing.dto";
import { lossPercent, normDeviation } from "./processing-policy";
type Tx = Prisma.TransactionClient;
const sum = (values: Prisma.Decimal[]) =>
  values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class ProcessingService extends LedgerService {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
  protected override async validateCommandReplay(
    name: string,
    result: Prisma.JsonValue,
    tx: Tx,
    user: CurrentUser,
  ) {
    if (!name.startsWith("process.")) return;
    const r = result as Record<string, any>;
    const ids = [
      r.batchId,
      r.bag?.batchId,
      ...(r.outputs ?? []).map((b: any) => b.id),
      ...(r.bags ?? []).map((b: any) => b.batchId),
    ].filter(Boolean);
    for (const id of ids) await this.item(tx, id, user);
  }
  private scope(user: CurrentUser): Prisma.MaterialBatchWhereInput {
    return {
      organizationId: user.organizationId,
      ...(user.accessAllObjects
        ? {}
        : {
            OR: [
              {
                stocks: {
                  some: { warehouseId: { in: user.warehouseScopeIds ?? [] } },
                },
              },
              {
                waybills: {
                  some: {
                    destinationWarehouseId: {
                      in: user.warehouseScopeIds ?? [],
                    },
                  },
                },
              },
              {
                bigBag: {
                  process: {
                    toWarehouseId: { in: user.warehouseScopeIds ?? [] },
                  },
                },
              },
              { id: "__not_assigned__" },
            ],
          }),
    };
  }
  private async item(tx: Tx, id: string, user: CurrentUser) {
    const batch = await tx.materialBatch.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        bigBag: { include: { process: true } },
        laboratoryAnalyses: { orderBy: { measuredAt: "desc" } },
        stocks: true,
        waybills: {
          include: {
            driver: { select: { fullName: true, phone: true } },
            vehicle: { select: { plateNumber: true } },
          },
        },
      },
    });
    if (!batch)
      throw new NotFoundException("Партия не найдена или не назначена");
    return batch;
  }
  private async root(tx: Tx, batchId: string) {
    const bag = await tx.bigBag.findUnique({
      where: { batchId },
      include: { process: true },
    });
    if (bag) return bag.process.rootBatchId;
    const prepared = await tx.processRun.findUnique({
      where: { preparedBatchId: batchId },
    });
    return prepared?.rootBatchId ?? batchId;
  }
  async scan(token: string, user: CurrentUser) {
    const trip = await this.prisma.waybill.findFirst({
      where: { organizationId: user.organizationId, qrTokenHash: hash(token) },
      include: {
        driver: { select: { fullName: true, phone: true } },
        vehicle: { select: { plateNumber: true } },
      },
    });
    const batch = trip?.batchId
      ? await this.item(this.prisma, trip.batchId, user)
      : await this.prisma.materialBatch
          .findFirst({
            where: { qrTokenHash: hash(token), ...this.scope(user) },
          })
          .then((b) => (b ? this.item(this.prisma, b.id, user) : null));
    if (!batch)
      throw new NotFoundException("QR партии не найден или недоступен");
    return this.describe(batch, user, trip, token);
  }
  async detail(id: string, user: CurrentUser) {
    const batch = await this.item(this.prisma, id, user);
    const receipt = await this.prisma.commandReceipt.findFirst({
      where: {
        organizationId: user.organizationId,
        OR: [
          {
            response: { path: ["batchId"], equals: id },
          },
          { response: { path: ["id"], equals: id } },
          {
            response: { path: ["outputs"], array_contains: [{ id }] },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { response: true },
    });
    const response = receipt?.response as Record<string, any> | undefined;
    const qr =
      response?.outputs?.find((b: any) => b.id === id)?.qrToken ??
      response?.qrToken;
    const trip = batch.waybills.find((t) => t.bagCount !== null) ?? null;
    return this.describe(
      batch,
      user,
      trip,
      typeof qr === "string" ? qr : undefined,
    );
  }
  private async describe(
    batch: Awaited<ReturnType<ProcessingService["item"]>>,
    user: CurrentUser,
    trip: any,
    token?: string,
  ) {
    const rootBatchId = await this.root(this.prisma, batch.id);
    const analyses =
      rootBatchId === batch.id
        ? batch.laboratoryAnalyses
        : await this.prisma.laboratoryAnalysis.findMany({
            where: { batchId: rootBatchId },
            orderBy: { measuredAt: "desc" },
          });
    const prepared = await this.prisma.processRun.findFirst({
      where: {
        organizationId: user.organizationId,
        rootBatchId,
        kind: "PREWASH",
      },
      select: { preparedBatchId: true, toWarehouseId: true },
    });
    const available = prepared?.preparedBatchId
      ? await this.prisma.batchStock.aggregate({
          where: { batchId: prepared.preparedBatchId },
          _sum: { quantity: true },
        })
      : null;
    const rootFacts = await this.prisma.materialBatch.findFirstOrThrow({
      where: { id: rootBatchId, organizationId: user.organizationId },
      select: {
        actualCollectedQuantity: true,
        actualBagCount: true,
        waybills: {
          select: {
            receivedWeight: true,
            receiptWarehouseId: true,
            destinationWarehouseId: true,
            acceptedAt: true,
          },
        },
      },
    });
    return {
      batch,
      rootFacts: {
        ...rootFacts,
        physicalReceivedQuantity: sum(
          rootFacts.waybills
            .filter((t) => t.acceptedAt && t.receivedWeight)
            .map((t) => t.receivedWeight!),
        ),
        physicalReceivedByWarehouse: Object.fromEntries(
          [
            ...new Set(
              rootFacts.waybills.map(
                (t) => t.receiptWarehouseId ?? t.destinationWarehouseId,
              ),
            ),
          ].map((id) => [
            id,
            sum(
              rootFacts.waybills
                .filter(
                  (t) =>
                    (t.receiptWarehouseId ?? t.destinationWarehouseId) === id &&
                    t.acceptedAt &&
                    t.receivedWeight,
                )
                .map((t) => t.receivedWeight!),
            ),
          ]),
        ),
      },
      qrToken: token ?? null,
      trip: trip ?? batch.waybills[0] ?? null,
      rootBatchId,
      qrImage: token ? await QRCode.toDataURL(token) : null,
      analyses,
      preparedBatchId: prepared?.preparedBatchId ?? null,
      preparedWarehouseId: prepared?.toWarehouseId ?? null,
      preparedAvailable: Boolean(available?._sum.quantity?.gt(0)),
    };
  }
  private async processDetails(ids: string[], user: CurrentUser) {
    const rows = ids.length
      ? await this.prisma.auditLog.findMany({
          where: {
            organizationId: user.organizationId,
            entity: "ProcessRun",
            action: "process.run",
            entityId: { in: ids },
          },
          select: { entityId: true, newValue: true },
        })
      : [];
    return new Map(
      rows.map((row) => {
        const v = row.newValue as Record<string, any> | null;
        return [
          row.entityId!,
          {
            comparisonBaseQuantity: v?.comparisonBaseQuantity ?? null,
            balance: v?.balance ?? null,
            shift: v?.shift ?? null,
            lineLabel: v?.lineLabel ?? null,
          },
        ];
      }),
    );
  }
  async laboratoryRegistry(q: ProcessingRegistryDto, user: CurrentUser) {
    const where: Prisma.LaboratoryAnalysisWhereInput = {
      batch: {
        ...this.scope(user),
        ...(q.search
          ? { number: { contains: q.search, mode: "insensitive" } }
          : {}),
      },
      ...(q.from || q.to
        ? {
            measuredAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.laboratoryAnalysis.findMany({
        where,
        include: {
          batch: {
            select: {
              id: true,
              number: true,
              actualCollectedQuantity: true,
              actualBagCount: true,
            },
          },
        },
        orderBy: { measuredAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.laboratoryAnalysis.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: rows.map((a) => a.createdById) },
      },
      select: { id: true, fullName: true },
    });
    return {
      scopeEmpty:
        !user.accessAllObjects && !(user.warehouseScopeIds ?? []).length,
      data: rows.map((a) => ({
        ...a,
        calculatedQuantity: a.baseQuantity
          .mul(new Prisma.Decimal(100).minus(a.sedimentPercent))
          .div(100),
        analystName:
          actors.find((u) => u.id === a.createdById)?.fullName ?? "Сотрудник",
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async bagRegistry(q: ProcessingRegistryDto, user: CurrentUser) {
    const where: Prisma.BigBagWhereInput = {
      batch: {
        ...this.scope(user),
        ...(q.search
          ? { number: { contains: q.search, mode: "insensitive" } }
          : {}),
      },
      ...(q.stage && ["WASHED", "DRIED"].includes(q.stage)
        ? { stage: q.stage }
        : {}),
      ...(q.status === "PACKED"
        ? { packedAt: { not: null } }
        : q.status === "SOLD"
          ? { soldAt: { not: null } }
          : q.status === "AVAILABLE"
            ? { soldAt: null }
            : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bigBag.findMany({
        where,
        include: {
          batch: {
            select: {
              id: true,
              number: true,
              state: true,
              stocks: {
                where: {
                  warehouseId: user.accessAllObjects
                    ? undefined
                    : { in: user.warehouseScopeIds ?? [] },
                },
              },
            },
          },
          process: {
            select: { rootBatchId: true, number: true, createdAt: true },
          },
        },
        orderBy: { process: { createdAt: "desc" } },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.bigBag.count({ where }),
    ]);
    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        organizationId: user.organizationId,
        id: {
          in: rows.flatMap((b) => b.batch.stocks.map((s) => s.warehouseId)),
        },
      },
      select: { id: true, name: true },
    });
    const actors = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: {
          in: rows.flatMap((b) =>
            [b.packedById, b.receivedById, b.soldById].filter(
              (id): id is string => Boolean(id),
            ),
          ),
        },
      },
      select: { id: true, fullName: true },
    });
    return {
      scopeEmpty:
        !user.accessAllObjects && !(user.warehouseScopeIds ?? []).length,
      data: rows.map((b) => ({
        ...b,
        batch: {
          ...b.batch,
          stocks: b.batch.stocks.map((s) => ({
            ...s,
            warehouse: warehouses.find((w) => w.id === s.warehouseId) ?? null,
          })),
        },
        packedByName:
          actors.find((u) => u.id === b.packedById)?.fullName ?? null,
        receivedByName:
          actors.find((u) => u.id === b.receivedById)?.fullName ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  laboratory(dto: LaboratoryDto, user: CurrentUser) {
    this.require(user, "laboratory.manage");
    const moisture = new Prisma.Decimal(dto.moisturePercent);
    const sediment = new Prisma.Decimal(dto.sedimentPercent);
    if (sediment.lt(0) || sediment.gte(100))
      throw new BadRequestException("Осадок должен быть от 0 до менее 100%");
    if (
      moisture.lt(0) ||
      moisture.gt(100) ||
      Date.parse(dto.measuredAt) > Date.now() + 30000
    )
      throw new BadRequestException(
        "Влажность должна быть от 0 до 100%, дата — не в будущем",
      );
    return this.command(user, "process.laboratory", dto, async (tx) => {
      await this.item(tx, dto.batchId, user);
      const root = await this.root(tx, dto.batchId);
      if (
        await tx.processRun.count({
          where: { rootBatchId: root, organizationId: user.organizationId },
        })
      )
        throw new ConflictException(
          "Обработка уже началась. Исходный анализ нельзя изменять задним числом",
        );
      const origin = await this.item(tx, root, user);
      const trip = origin.waybills.find((t) => t.bagCount !== null);
      if (!trip)
        throw new ConflictException("Нужна исходная отправка сборщика");
      const baseQuantity = trip.receivedWeight ?? trip.declaredWeight;
      const actualQuantity = baseQuantity
        .mul(new Prisma.Decimal(100).minus(sediment))
        .div(100)
        .toDecimalPlaces(3);
      if (actualQuantity.lte(0))
        throw new BadRequestException(
          "Фактический вес после осадка должен быть больше нуля",
        );
      if (trip.receivedWeight) {
        const stocks = origin.stocks.filter((s) => s.quantity.gt(0));
        if (stocks.length !== 1)
          throw new ConflictException(
            "Партия распределена по складам; требуется сверка до анализа",
          );
        await this.move(
          tx,
          user,
          root,
          stocks[0].warehouseId,
          actualQuantity.minus(stocks[0].quantity),
          "LAB_SEDIMENT",
          undefined,
          trip.id,
          "Лабораторный осадок " + dto.sedimentPercent + "%",
        );
      }
      await tx.materialBatch.update({
        where: { id: root },
        data: {
          actualCollectedQuantity: actualQuantity,
          actualBagCount: dto.actualBagCount,
        },
      });
      await this.files(tx, dto.fileIds, "MaterialBatch", root, user);
      const analysis = await tx.laboratoryAnalysis.create({
        data: {
          batchId: root,
          moisturePercent: moisture,
          sedimentPercent: sediment,
          baseQuantity,
          actualQuantity,
          actualBagCount: dto.actualBagCount,
          measuredAt: new Date(dto.measuredAt),
          notes: dto.notes,
          createdById: user.id,
        },
      });
      await this.audit(
        tx,
        user,
        "process.laboratory",
        "MaterialBatch",
        root,
        null,
        analysis,
      );
      return analysis;
    });
  }
  receive(id: string, dto: ReceiveCollectionDto, user: CurrentUser) {
    this.require(user, "processing.receive");
    const quantity = mass(dto.quantity);
    return this.command(user, `process.receive:${id}`, dto, async (tx) => {
      const trip = await tx.waybill.findFirst({
        where: {
          id,
          organizationId: user.organizationId,
          batchId: { not: null },
        },
      });
      if (!trip || trip.bagCount === null)
        throw new NotFoundException("Отправка сборщика не найдена");
      await this.warehouse(tx, dto.warehouseId, user);
      if (trip.destinationWarehouseId !== dto.warehouseId)
        throw new BadRequestException("Склад не совпадает с назначением");
      if (!["LOADED", "IN_TRANSIT", "ARRIVED"].includes(trip.status))
        throw new ConflictException("Эта отправка уже принята или закрыта");
      const difference =
        !quantity.eq(trip.declaredWeight) || dto.bagCount !== trip.bagCount;
      if (difference) this.reason(dto.reason);
      await this.files(tx, dto.fileIds, "Waybill", id, user);
      const updated = await tx.waybill.update({
        where: { id },
        data: {
          status: difference ? "ACCEPTED_WITH_DIFFERENCE" : "ACCEPTED",
          receivedWeight: quantity,
          receivedBagCount: dto.bagCount,
          arrivedAt: trip.arrivedAt ?? new Date(),
          acceptedAt: new Date(),
          acceptedById: user.id,
          receiptWarehouseId: dto.warehouseId,
          discrepancyReason: dto.reason,
          version: { increment: 1 },
        },
      });
      const lab = await tx.laboratoryAnalysis.findFirst({
        where: { batchId: trip.batchId! },
        orderBy: { createdAt: "desc" },
      });
      const actualQuantity = lab
        ? quantity
            .mul(new Prisma.Decimal(100).minus(lab.sedimentPercent))
            .div(100)
            .toDecimalPlaces(3)
        : quantity;
      if (actualQuantity.lte(0))
        throw new BadRequestException("Нет материала после вычета осадка");
      await tx.materialBatch.update({
        where: { id: trip.batchId! },
        data: {
          actualCollectedQuantity: actualQuantity,
          actualBagCount: lab?.actualBagCount ?? dto.bagCount,
        },
      });
      await this.move(
        tx,
        user,
        trip.batchId!,
        dto.warehouseId,
        actualQuantity,
        "COLLECTION_RECEIPT",
        undefined,
        id,
        dto.reason,
      );
      await this.audit(
        tx,
        user,
        "process.receive",
        "Waybill",
        id,
        trip,
        updated,
        dto.reason,
      );
      return updated;
    });
  }
  process(dto: ProcessDto, user: CurrentUser) {
    this.require(
      user,
      dto.kind === "DRYING" ? "processing.dry" : "processing.wash",
    );
    if (new Set(dto.batchIds).size !== dto.batchIds.length)
      throw new BadRequestException("Один QR указан несколько раз");
    const weights = dto.outputWeights.map((w) => mass(w));
    const output = sum(weights);
    if (
      dto.kind === "PREWASH" &&
      (dto.batchIds.length !== 1 || weights.length !== 1)
    )
      throw new BadRequestException(
        "Перед мойкой взвешивается одна исходная партия",
      );
    return this.command(user, "process.run", dto, async (tx) => {
      await this.warehouse(tx, dto.fromWarehouseId, user);
      await this.warehouse(tx, dto.toWarehouseId, user);
      const inputs = await Promise.all(
        dto.batchIds.map((id) => this.item(tx, id, user)),
      );
      const roots = await Promise.all(inputs.map((b) => this.root(tx, b.id)));
      if (new Set(roots).size !== 1)
        throw new BadRequestException(
          "Обрабатывайте биг-бэги одной исходной партии, чтобы сохранить прослеживаемость",
        );
      const rootBatchId = roots[0];
      if (
        !(await tx.laboratoryAnalysis.count({
          where: { batchId: rootBatchId },
        }))
      )
        throw new ConflictException(
          "Сначала лаборатория должна указать влажность партии",
        );
      for (const b of inputs) {
        if (
          dto.kind === "PREWASH" &&
          (b.id !== rootBatchId ||
            !b.waybills.some((t) =>
              [
                "ACCEPTED",
                "ACCEPTED_WITH_DIFFERENCE",
                "UNLOADED",
                "COMPLETED",
              ].includes(t.status),
            ))
        )
          throw new ConflictException("Нужна принятая исходная партия");
        if (
          dto.kind === "WASHING" &&
          !(await tx.processRun.findFirst({
            where: { preparedBatchId: b.id, kind: "PREWASH" },
          }))
        )
          throw new ConflictException(
            "Сначала выполните отдельное взвешивание перед мойкой",
          );
        if (
          dto.kind === "DRYING" &&
          (!b.bigBag || b.bigBag.stage !== "WASHED" || b.bigBag.soldAt)
        )
          throw new ConflictException(
            "На завод поступают только доступные мытые биг-бэги",
          );
      }
      if (
        dto.kind === "DRYING" &&
        inputs.some(
          (b) =>
            !b.bigBag?.factoryStartedAt ||
            b.bigBag.factoryWarehouseId !== dto.fromWarehouseId,
        )
      )
        throw new ConflictException(
          "Сначала примите каждый входной биг-бэг на завод по QR",
        );
      const quantities = inputs.map(
        (b) =>
          b.stocks.find((s) => s.warehouseId === dto.fromWarehouseId)
            ?.quantity ?? new Prisma.Decimal(0),
      );
      if (quantities.some((q) => q.lte(0)))
        throw new ConflictException(
          "Партия уже израсходована или отсутствует на этом складе",
        );
      if (
        inputs.some((b, i) => b.bigBag && !quantities[i].eq(b.bigBag.quantity))
      )
        throw new ConflictException(
          "Биг-бэг был использован частично; требуется сверка",
        );
      const input = sum(quantities);
      if (output.gt(input))
        throw new BadRequestException("Выход не может превышать входной вес");
      let comparisonBase = input;
      if (dto.kind === "PREWASH") {
        if (
          await tx.processRun.count({
            where: {
              organizationId: user.organizationId,
              rootBatchId,
              kind: "PREWASH",
              fromWarehouseId: dto.fromWarehouseId,
            },
          })
        )
          throw new ConflictException(
            "Взвешивание этой принятой части партии уже выполнено",
          );
        comparisonBase = sum(
          inputs[0].waybills
            .filter(
              (t) =>
                t.acceptedAt &&
                t.receivedWeight &&
                (t.receiptWarehouseId ?? t.destinationWarehouseId) ===
                  dto.fromWarehouseId,
            )
            .map((t) => t.receivedWeight!),
        );
        if (comparisonBase.lte(0))
          throw new ConflictException(
            "Нет подтверждённого физически принятого веса для сравнения",
          );
        if (
          inputs[0].waybills.some(
            (t) =>
              (t.receiptWarehouseId ?? t.destinationWarehouseId) ===
                dto.fromWarehouseId &&
              [
                "CREATED",
                "LOADED",
                "IN_TRANSIT",
                "ARRIVED",
                "PARTIALLY_ACCEPTED",
                "REVIEW",
              ].includes(t.status),
          )
        )
          throw new ConflictException(
            "Сначала завершите приёмку соответствующих рейсов; частичный рейс не считается полностью принятым",
          );
      }
      const remainder = input.minus(output);
      const hasBreakdown = [
        dto.wasteQuantity,
        dto.lossQuantity,
        dto.defectQuantity,
      ].some((v) => v !== undefined);
      const parsePart = (v?: string) =>
        v === undefined || /^0(?:\.0{1,3})?$/.test(v)
          ? new Prisma.Decimal(0)
          : mass(v);
      const breakdown = hasBreakdown
        ? {
            wasteQuantity: parsePart(dto.wasteQuantity),
            lossQuantity: parsePart(dto.lossQuantity),
            defectQuantity: parsePart(dto.defectQuantity),
          }
        : {
            wasteQuantity: new Prisma.Decimal(0),
            lossQuantity: remainder,
            defectQuantity: new Prisma.Decimal(0),
          };
      if (!sum(Object.values(breakdown)).eq(remainder))
        throw new BadRequestException(
          "Баланс не сходится: вход = выход + отходы + потери + брак. Каждая масса учитывается один раз.",
        );
      const coefficient = lossPercent(comparisonBase, output).toDecimalPlaces(
        3,
      );
      const min = dto.kind === "PREWASH" ? 21 : dto.kind === "DRYING" ? 36 : 0;
      const max =
        dto.kind === "PREWASH" ? 27 : dto.kind === "DRYING" ? 36 : 100;
      const deviation = normDeviation(coefficient, min, max);
      if (deviation !== "NORMAL") this.reason(dto.reason);
      if (
        dto.kind === "DRYING" &&
        (!dto.productTypeId ||
          !(await tx.productType.findUnique({
            where: { id: dto.productTypeId },
          })))
      )
        throw new BadRequestException("Выберите вид готовой продукции");
      const run = await tx.processRun.create({
        data: {
          organizationId: user.organizationId,
          rootBatchId,
          number: `${user.organizationId}-${await nextDocumentNumber(tx, user.organizationId, "PROC")}`,
          kind: dto.kind,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          inputQuantity: input,
          outputQuantity: output,
          coefficientPercent: coefficient.toDecimalPlaces(3),
          coefficientBasis: dto.kind === "PREWASH" ? "RECEIVED_LOSS" : "LOSS",
          normMinPercent: min,
          normMaxPercent: max,
          deviation,
          reason: dto.reason,
          createdById: user.id,
          inputs: {
            create: inputs.map((b, i) => ({
              batchId: b.id,
              quantity: quantities[i],
            })),
          },
        },
      });
      for (let i = 0; i < inputs.length; i++)
        await this.move(
          tx,
          user,
          inputs[i].id,
          dto.fromWarehouseId,
          quantities[i].neg(),
          `${dto.kind}_INPUT`,
          undefined,
          undefined,
          `Process ${run.id}`,
        );
      const outputs = [];
      for (let i = 0; i < weights.length; i++) {
        const token = randomBytes(32).toString("base64url");
        const batch = await tx.materialBatch.create({
          data: {
            organizationId: user.organizationId,
            number: `${user.organizationId}-${await nextDocumentNumber(tx, user.organizationId, "LOT")}`,
            qrTokenHash: hash(token),
            state:
              dto.kind === "PREWASH"
                ? "DIRTY"
                : dto.kind === "WASHING"
                  ? "WASHED"
                  : "FINISHED",
            status: "CONFIRMED",
            materialTypeId:
              dto.kind === "DRYING" ? null : inputs[0].materialTypeId,
            productTypeId: dto.kind === "DRYING" ? dto.productTypeId : null,
            originCounterpartyIds: inputs[0].originCounterpartyIds,
            originExtractionSiteIds: inputs[0].originExtractionSiteIds,
            initialQuantity: weights[i],
            availableSourceQuantity: 0,
            measurementMethod: "Контрольное взвешивание",
            measuredAt: new Date(),
            createdById: user.id,
          },
        });
        if (dto.kind === "PREWASH")
          await tx.processRun.update({
            where: { id: run.id },
            data: { preparedBatchId: batch.id },
          });
        else
          await tx.bigBag.create({
            data: {
              batchId: batch.id,
              processId: run.id,
              ordinal: i + 1,
              quantity: weights[i],
              stage: dto.kind === "WASHING" ? "WASHED" : "DRIED",
            },
          });
        await this.move(
          tx,
          user,
          batch.id,
          dto.toWarehouseId,
          weights[i],
          `${dto.kind}_OUTPUT`,
          undefined,
          undefined,
          `Process ${run.id}`,
        );
        outputs.push({
          ...batch,
          ordinal: i + 1,
          qrToken: token,
          qrImage: await QRCode.toDataURL(token),
        });
      }
      await this.files(tx, dto.fileIds, "MaterialBatch", outputs[0].id, user);
      await this.audit(
        tx,
        user,
        "process.run",
        "ProcessRun",
        run.id,
        null,
        {
          ...run,
          comparisonBaseQuantity: comparisonBase.toString(),
          balance: breakdown,
          shift: dto.shift?.trim() || null,
          lineLabel: dto.lineLabel?.trim() || null,
          outputBatchIds: outputs.map((b) => b.id),
        },
        dto.reason,
      );
      return {
        run: {
          ...run,
          comparisonBaseQuantity: comparisonBase.toString(),
          balance: breakdown,
          shift: dto.shift?.trim() || null,
          lineLabel: dto.lineLabel?.trim() || null,
        },
        outputs,
      };
    });
  }
  factoryIntake(id: string, dto: BagReceiptDto, user: CurrentUser) {
    this.require(user, "processing.dry");
    return this.command(
      user,
      `process.factory-intake:${id}`,
      dto,
      async (tx) => {
        const batch = await this.item(tx, id, user);
        const bag = batch.bigBag;
        if (!bag || bag.stage !== "WASHED" || bag.soldAt)
          throw new ConflictException(
            "На завод принимается доступный мытый биг-бэг",
          );
        await this.warehouse(tx, dto.warehouseId, user);
        if (bag.factoryStartedAt) return { alreadyReceived: true, bag };
        const stock = batch.stocks.find((s) => s.quantity.eq(bag.quantity));
        if (!stock)
          throw new ConflictException(
            "Биг-бэг отсутствует или уже использован",
          );
        await this.warehouse(tx, stock.warehouseId, user);
        if (stock.warehouseId !== dto.warehouseId) {
          await this.move(
            tx,
            user,
            id,
            stock.warehouseId,
            bag.quantity.neg(),
            "FACTORY_INTAKE_OUT",
          );
          await this.move(
            tx,
            user,
            id,
            dto.warehouseId,
            bag.quantity,
            "FACTORY_INTAKE_IN",
          );
        }
        const updated = await tx.bigBag.update({
          where: { id: bag.id },
          data: {
            factoryStartedAt: new Date(),
            factoryStartedById: user.id,
            factoryWarehouseId: dto.warehouseId,
          },
        });
        await this.audit(
          tx,
          user,
          "process.factory-intake",
          "BigBag",
          bag.id,
          bag,
          updated,
        );
        return { alreadyReceived: false, bag: updated };
      },
    );
  }
  receiveBag(id: string, dto: BagReceiptDto, user: CurrentUser) {
    this.require(user, "processing.finished");
    return this.command(user, `process.finished:${id}`, dto, async (tx) => {
      const batch = await this.item(tx, id, user);
      const bag = batch.bigBag;
      if (!bag || bag.stage !== "DRIED" || bag.soldAt)
        throw new ConflictException("Нужен высушенный непроданный биг-бэг");
      await this.warehouse(tx, dto.warehouseId, user);
      if (bag.receivedAt) return { alreadyReceived: true, bag };
      const from = bag.process.toWarehouseId;
      await this.warehouse(tx, from, user);
      if (from !== dto.warehouseId) {
        await this.move(
          tx,
          user,
          id,
          from,
          bag.quantity.neg(),
          "FINISHED_TRANSFER_OUT",
        );
        await this.move(
          tx,
          user,
          id,
          dto.warehouseId,
          bag.quantity,
          "FINISHED_RECEIPT",
        );
      } else {
        const stock = batch.stocks.find((s) => s.warehouseId === from);
        if (!stock?.quantity.eq(bag.quantity))
          throw new ConflictException("Вес биг-бэга не совпадает с остатком");
      }
      const updated = await tx.bigBag.update({
        where: { id: bag.id },
        data: {
          receivedAt: new Date(),
          receivedById: user.id,
          receivedWarehouseId: dto.warehouseId,
        },
      });
      await this.audit(
        tx,
        user,
        "process.finished",
        "BigBag",
        bag.id,
        null,
        updated,
      );
      return { alreadyReceived: false, bag: updated };
    });
  }
  pack(id: string, dto: PackDto, user: CurrentUser) {
    this.require(user, "processing.pack");
    if (
      !Number.isFinite(Date.parse(dto.workDate + "T00:00:00Z")) ||
      new Date(dto.workDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        dto.workDate ||
      !dto.shift.trim()
    )
      throw new BadRequestException("Укажите дату и смену");
    return this.command(user, `process.pack:${id}`, dto, async (tx) => {
      const batch = await this.item(tx, id, user);
      const bag = batch.bigBag;
      if (!bag || bag.stage !== "DRIED" || bag.soldAt)
        throw new ConflictException(
          "Упаковывается только высушенный непроданный биг-бэг",
        );
      if (bag.packedAt) return { alreadyPacked: true, bag };
      if (!bag.receivedAt || !bag.receivedWarehouseId)
        throw new ConflictException(
          "Сначала примите готовый биг-бэг на склад по QR. Упаковка доступна после приёмки.",
        );
      await this.warehouse(tx, bag.receivedWarehouseId, user);
      if (!batch.stocks.some((s) => s.quantity.eq(bag.quantity)))
        throw new ConflictException("Биг-бэг недоступен на остатках");
      const updated = await tx.bigBag.update({
        where: { id: bag.id },
        data: {
          packedAt: new Date(),
          packedById: user.id,
          packingShift: dto.shift.trim(),
          packingDate: dto.workDate,
        },
      });
      await this.audit(
        tx,
        user,
        "process.pack",
        "BigBag",
        bag.id,
        null,
        updated,
      );
      return { alreadyPacked: false, bag: updated };
    });
  }
  sell(dto: SellDto, user: CurrentUser) {
    this.require(user, "processing.sell");
    if (
      !dto.recipient.trim() ||
      !dto.documentNumber.trim() ||
      new Set(dto.batchIds).size !== dto.batchIds.length
    )
      throw new BadRequestException(
        "Укажите покупателя, документ и уникальные QR",
      );
    return this.command(user, "process.sell", dto, async (tx) => {
      await this.warehouse(tx, dto.warehouseId, user);
      const bags = [];
      for (const id of dto.batchIds) {
        const batch = await this.item(tx, id, user);
        const bag = batch.bigBag;
        if (!bag || bag.soldAt || !["WASHED", "DRIED"].includes(bag.stage))
          throw new ConflictException(
            "Биг-бэг уже продан или не готов к отпуску",
          );
        if (bag.stage === "WASHED" && bag.factoryStartedAt)
          throw new ConflictException(
            "Биг-бэг уже в работе на заводе и не может быть продан как мытый",
          );
        if (bag.stage === "DRIED" && !bag.receivedAt)
          throw new ConflictException(
            "Сначала примите готовый биг-бэг на склад",
          );
        const stock = batch.stocks.find(
          (s) => s.warehouseId === dto.warehouseId,
        );
        if (!stock?.quantity.eq(bag.quantity))
          throw new ConflictException(
            "Биг-бэг отсутствует или использован частично",
          );
        await this.move(
          tx,
          user,
          id,
          dto.warehouseId,
          bag.quantity.neg(),
          "SALE",
          undefined,
          undefined,
          `${dto.documentNumber.trim()}: ${dto.recipient.trim()}`,
        );
        const updated = await tx.bigBag.update({
          where: { id: bag.id },
          data: {
            soldAt: new Date(),
            soldById: user.id,
            saleRecipient: dto.recipient.trim(),
            saleDocument: dto.documentNumber.trim(),
          },
        });
        bags.push(updated);
        await this.audit(
          tx,
          user,
          "process.sell",
          "BigBag",
          bag.id,
          bag,
          updated,
        );
      }
      return {
        bags,
        count: bags.length,
        quantity: sum(bags.map((b) => b.quantity)),
      };
    });
  }
  async packingStats(user: CurrentUser, from: string, to: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    )
      throw new BadRequestException("Укажите период статистики");
    const rows = await this.prisma.bigBag.groupBy({
      by: ["packedById", "packingDate", "packingShift"],
      where: {
        packingDate: { gte: from, lte: to },
        packedAt: { not: null },
        batch: { organizationId: user.organizationId },
        ...(!user.accessAllObjects ? { packedById: user.id } : {}),
      },
      _count: { _all: true },
      _sum: { quantity: true },
      orderBy: [{ packingDate: "desc" }, { packingShift: "asc" }],
    });
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: {
          in: rows
            .map((r) => r.packedById)
            .filter((id): id is string => Boolean(id)),
        },
      },
      select: { id: true, fullName: true },
    });
    return rows.map((r) => ({
      ...r,
      packedByName:
        users.find((u) => u.id === r.packedById)?.fullName ?? "Сотрудник",
    }));
  }
  async trace(batchId: string, user: CurrentUser) {
    await this.item(this.prisma, batchId, user);
    const rootBatchId = await this.root(this.prisma, batchId);
    const root = await this.prisma.materialBatch.findFirstOrThrow({
      where: { id: rootBatchId, organizationId: user.organizationId },
      include: {
        laboratoryAnalyses: true,
        waybills: { include: { driver: true, vehicle: true } },
        stocks: true,
      },
    });
    const runs = await this.prisma.processRun.findMany({
      where: { rootBatchId, organizationId: user.organizationId },
      include: {
        inputs: true,
        bags: { include: { batch: { include: { stocks: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    const details = await this.processDetails(
      runs.map((r) => r.id),
      user,
    );
    const bags = runs.flatMap((r) => r.bags);
    const finished = sum(
      bags.filter((b) => b.stage === "DRIED").map((b) => b.quantity),
    );
    const washedSold = sum(
      bags
        .filter((b) => b.stage === "WASHED" && b.soldAt)
        .map((b) => b.quantity),
    );
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: {
          in: [
            root.createdById,
            ...bags
              .flatMap((b) => [b.receivedById, b.packedById, b.soldById])
              .filter((id): id is string => Boolean(id)),
            ...runs.map((r) => r.createdById),
            ...root.laboratoryAnalyses.map((a) => a.createdById),
            ...root.waybills
              .map((t) => t.acceptedById)
              .filter((id): id is string => Boolean(id)),
          ],
        },
      },
      select: { id: true, fullName: true },
    });
    const files = await this.prisma.file.findMany({
      where: {
        organizationId: user.organizationId,
        verifiedAt: { not: null },
        OR: [
          {
            entityType: "Waybill",
            entityId: { in: root.waybills.map((t) => t.id) },
          },
          {
            entityType: "MaterialBatch",
            entityId: {
              in: [
                root.id,
                ...runs
                  .map((r) => r.preparedBatchId)
                  .filter((id): id is string => Boolean(id)),
                ...bags.map((b) => b.batchId),
              ],
            },
          },
        ],
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        entityId: true,
        createdAt: true,
      },
    });
    return {
      root: {
        ...root,
        createdByName:
          users.find((u) => u.id === root.createdById)?.fullName ?? "Сотрудник",
        laboratoryAnalyses: root.laboratoryAnalyses.map((a) => ({
          ...a,
          analystName:
            users.find((u) => u.id === a.createdById)?.fullName ??
            "Лаборатория",
        })),
        waybills: root.waybills.map((t) => ({
          ...t,
          acceptedByName:
            users.find((u) => u.id === t.acceptedById)?.fullName ?? null,
        })),
      },
      files,
      runs: runs.map((r) => ({
        ...r,
        ...details.get(r.id),
        createdByName:
          users.find((u) => u.id === r.createdById)?.fullName ?? "Сотрудник",
        bags: r.bags.map((b) => ({
          ...b,
          packedByName:
            users.find((u) => u.id === b.packedById)?.fullName ?? null,
          receivedByName:
            users.find((u) => u.id === b.receivedById)?.fullName ?? null,
          soldByName: users.find((u) => u.id === b.soldById)?.fullName ?? null,
        })),
      })),
      summary: {
        collected: root.initialQuantity,
        finishedProduced: finished,
        washedSold,
        expectedFinished: root.initialQuantity.mul("0.49").toDecimalPlaces(3),
        actualFinishedPercent: finished
          .mul(100)
          .div(root.initialQuantity)
          .toDecimalPlaces(3),
        actualLossPercent: lossPercent(
          root.initialQuantity,
          finished,
        ).toDecimalPlaces(3),
        normTotalLossPercent: 51,
        deviationPercentagePoints: lossPercent(root.initialQuantity, finished)
          .minus(51)
          .toDecimalPlaces(3),
        comparisonComplete:
          washedSold.isZero() &&
          bags
            .filter((b) => b.stage === "WASHED")
            .every((b) => b.batch.stocks.every((s) => s.quantity.isZero())) &&
          runs.some((r) => r.kind === "DRYING"),
      },
      note: "Остаток в обработке и продажа мытого материала учитываются отдельно; промежуточные и готовые веса не суммируются между собой.",
    };
  }
  async overview(user: CurrentUser) {
    this.require(user, "processing.overview");
    const org = user.organizationId;
    const [
      trips,
      runs,
      stocks,
      bags,
      alerts,
      warehouses,
      sourceTotals,
      legacy,
    ] = await Promise.all([
      this.prisma.waybill.findMany({
        where: {
          organizationId: org,
          batchId: { not: null },
          status: { notIn: ["DRAFT", "CANCELLED"] },
        },
        include: {
          driver: { select: { id: true, fullName: true, phone: true } },
          vehicle: { select: { plateNumber: true } },
          routePoints: { orderBy: { recordedAt: "desc" }, take: 1 },
        },
      }),
      this.prisma.processRun.findMany({
        where: { organizationId: org },
        select: {
          kind: true,
          preparedBatchId: true,
          inputQuantity: true,
          outputQuantity: true,
          deviation: true,
        },
      }),
      this.prisma.batchStock.findMany({
        where: { batch: { organizationId: org }, quantity: { gt: 0 } },
        include: { batch: { include: { bigBag: true } } },
      }),
      this.prisma.bigBag.findMany({
        where: { batch: { organizationId: org } },
      }),
      this.prisma.notification.findMany({
        where: {
          organizationId: org,
          type: { in: ["DRIVER_IDLE", "DRIVER_GPS_STALE"] },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        distinct: ["body"],
      }),
      this.prisma.warehouse.findMany({
        where: { organizationId: org },
        select: { id: true, name: true },
      }),
      this.prisma.materialBatch.aggregate({
        where: {
          organizationId: org,
          counterpartyId: { not: null },
          extractionSiteId: { not: null },
          status: { notIn: ["DRAFT", "CANCELLED"] },
        },
        _sum: { initialQuantity: true, availableSourceQuantity: true },
      }),
      this.prisma.batchOperation.findMany({
        where: {
          organizationId: org,
          status: "CONFIRMED",
          kind: { in: ["WASHING", "PRODUCTION", "SHIPMENT", "RETURN"] },
        },
        select: {
          kind: true,
          outputQuantity: true,
          inputs: { select: { quantity: true } },
        },
      }),
    ]);
    const stages = ["PREWASH", "WASHING", "DRYING"].map((kind) => ({
      kind,
      runs: runs.filter((r) => r.kind === kind).length,
      inputQuantity: sum(
        runs.filter((r) => r.kind === kind).map((r) => r.inputQuantity),
      ),
      outputQuantity: sum(
        runs.filter((r) => r.kind === kind).map((r) => r.outputQuantity),
      ),
    }));
    for (const stage of stages) {
      const old = legacy.filter(
        (r) =>
          r.kind ===
          (stage.kind === "WASHING"
            ? "WASHING"
            : stage.kind === "DRYING"
              ? "PRODUCTION"
              : "__none__"),
      );
      stage.runs += old.length;
      stage.inputQuantity = stage.inputQuantity.plus(
        sum(old.flatMap((r) => r.inputs.map((i) => i.quantity))),
      );
      stage.outputQuantity = stage.outputQuantity.plus(
        sum(old.map((r) => r.outputQuantity ?? new Prisma.Decimal(0))),
      );
    }
    const legacySold = sum(
      legacy
        .filter((r) => r.kind === "SHIPMENT")
        .flatMap((r) => r.inputs.map((i) => i.quantity)),
    ).minus(
      sum(
        legacy
          .filter((r) => r.kind === "RETURN")
          .flatMap((r) => r.inputs.map((i) => i.quantity)),
      ),
    );
    const inTransit = trips.filter((t) => t.status === "IN_TRANSIT");
    const stored = warehouses.map((w) => ({
      ...w,
      byState: ["DIRTY", "WASHED", "FINISHED"].map((state) => ({
        state,
        quantity: sum(
          stocks
            .filter((s) => s.warehouseId === w.id && s.batch.state === state)
            .map((s) => s.quantity),
        ),
        bigBags: stocks.filter(
          (s) =>
            s.warehouseId === w.id && s.batch.state === state && s.batch.bigBag,
        ).length,
      })),
    }));
    return {
      collected: sourceTotals._sum.initialQuantity ?? new Prisma.Decimal(0),
      sent: sum(trips.map((t) => t.declaredWeight)),
      received: sum(
        trips.map((t) => t.receivedWeight ?? new Prisma.Decimal(0)),
      ),
      stages,
      warehouses: stored,
      inTransitCount: inTransit.length,
      driversInTransit: new Set(
        inTransit.map((t) => t.driverId).filter(Boolean),
      ).size,
      tripsInTransit: inTransit,
      soldWashed: sum(
        bags
          .filter((b) => b.stage === "WASHED" && b.soldAt)
          .map((b) => b.quantity),
      ),
      soldFinished: sum(
        bags
          .filter((b) => b.stage === "DRIED" && b.soldAt)
          .map((b) => b.quantity),
      ).plus(legacySold),
      readyBigBags: bags.filter((b) => b.receivedAt && !b.soldAt).length,
      packedBigBags: bags.filter((b) => b.packedAt).length,
      awaitingFinishedReceipt: bags.filter(
        (b) => b.stage === "DRIED" && !b.receivedAt && !b.soldAt,
      ).length,
      alerts,
      deviations: runs.filter((r) => r.deviation !== "NORMAL").length,
      normTotalLossPercent: 51,
      currentStages: [
        {
          label: "На местах сбора: ещё не отправлено",
          quantity:
            sourceTotals._sum.availableSourceQuantity ?? new Prisma.Decimal(0),
        },
        {
          label: "В пути: по отправленному весу",
          quantity: sum(inTransit.map((t) => t.declaredWeight)),
        },
        {
          label: "На заводе в обработке",
          quantity: sum(
            stocks
              .filter(
                (s) =>
                  s.batch.state === "WASHED" &&
                  s.batch.bigBag?.factoryStartedAt,
              )
              .map((s) => s.quantity),
          ),
        },
        {
          label: "Сырьё до взвешивания перед мойкой",
          quantity: sum(
            stocks
              .filter(
                (s) =>
                  s.batch.state === "DIRTY" &&
                  !runs.some((r) => r.preparedBatchId === s.batchId),
              )
              .map((s) => s.quantity),
          ),
        },
        {
          label: "В мойке",
          quantity: sum(
            stocks
              .filter((s) => runs.some((r) => r.preparedBatchId === s.batchId))
              .map((s) => s.quantity),
          ),
        },
        {
          label: "Мытое: ожидает завода или продажи",
          quantity: sum(
            stocks
              .filter(
                (s) =>
                  s.batch.state === "WASHED" &&
                  !s.batch.bigBag?.factoryStartedAt,
              )
              .map((s) => s.quantity),
          ),
        },
        {
          label: "После завода: ожидает приёмки",
          quantity: sum(
            stocks
              .filter(
                (s) =>
                  s.batch.state === "FINISHED" &&
                  s.batch.bigBag &&
                  !s.batch.bigBag.receivedAt,
              )
              .map((s) => s.quantity),
          ),
        },
        {
          label: "Готовая продукция на складе",
          quantity: sum(
            stocks
              .filter(
                (s) =>
                  s.batch.state === "FINISHED" && s.batch.bigBag?.receivedAt,
              )
              .map((s) => s.quantity),
          ),
        },
      ],
    };
  }
}
