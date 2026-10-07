import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { toCsv, toXlsx, toPdf } from "../reports/reports.controller";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../common/permissions.decorator";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import {
  AccessDto,
  BatchDto,
  CommandDto,
  LedgerQuery,
  LoadingDto,
  OperationDto,
  ReasonDto,
  ReceiptDto,
  StatusDto,
  TripDto,
} from "./ledger.dto";
import { ResolveQrDto } from "../waybills/waybills.dto";
import { LedgerService } from "./ledger.service";

@ApiTags("ledger")
@ApiBearerAuth()
@Controller("ledger")
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}
  @Permissions("inventory.read") @Get("files/:type/:id") async files(
    @Param("type") type: string,
    @Param("id") id: string,
    @User() u: CurrentUser,
  ) {
    return this.ledger.listFiles(type, id, u);
  }
  @Permissions("inventory.read") @Get("batches") batches(
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
  ) {
    return this.ledger.batches(q, u);
  }
  @Permissions("batches.manage") @Post("batches") createBatch(
    @Body() d: BatchDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.createBatch(d, u);
  }
  @Permissions("batches.manage") @Post("batches/:id/confirm") confirmBatch(
    @Param("id") id: string,
    @Body() d: ReasonDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.batchAction(id, "confirm", d, u);
  }
  @Permissions("batches.manage") @Post("batches/:id/cancel") cancelBatch(
    @Param("id") id: string,
    @Body() d: ReasonDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.batchAction(id, "cancel", d, u);
  }
  @Permissions("batches.manage") @Post("batches/:id/close") closeBatch(
    @Param("id") id: string,
    @Body() d: ReasonDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.batchAction(id, "close", d, u);
  }
  @Permissions("inventory.read") @Get("batches/:id/trace") trace(
    @Param("id") id: string,
    @User() u: CurrentUser,
  ) {
    return this.ledger.trace(id, u);
  }
  @Permissions("inventory.read") @Get("waybills") trips(
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
  ) {
    return this.ledger.trips(q, u);
  }
  @Permissions("inventory.read") @Get("waybills/:id") trip(
    @Param("id") id: string,
    @User() u: CurrentUser,
  ) {
    return this.ledger.getTrip(id, u);
  }
  @Permissions("waybills.manage") @Post("waybills") createTrip(
    @Body() d: TripDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.createTrip(d, u);
  }
  @Permissions("loading.manage") @Post("waybills/:id/load") load(
    @Param("id") id: string,
    @Body() d: LoadingDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.loading(id, d, u);
  }
  @Permissions("inventory.read") @Post("waybills/:id/status") status(
    @Param("id") id: string,
    @Body() d: StatusDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.status(id, d, u);
  }
  @Permissions("waybills.accept") @Post("waybills/:id/receipt") receipt(
    @Param("id") id: string,
    @Body() d: ReceiptDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.receipt(id, d, u);
  }
  @Permissions("waybills.accept") @Post("waybills/:id/unload") unload(
    @Param("id") id: string,
    @Body() d: CommandDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.unload(id, d, u);
  }
  @Permissions("waybills.accept") @Post("qr/resolve") resolve(
    @Body() d: ResolveQrDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.resolve(d.token, u);
  }
  @Permissions("inventory.read") @Get("operations") operations(
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
  ) {
    return this.ledger.operations(q, u);
  }
  @Permissions("inventory.read") @Post("operations") operation(
    @Body() d: OperationDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.createOperation(d, u);
  }
  @Permissions("inventory.read")
  @Post("operations/:id/confirm")
  confirmOperation(
    @Param("id") id: string,
    @Body() d: CommandDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.confirmOperation(id, d, u);
  }
  @Permissions("inventory.read") @Post("operations/:id/cancel") cancelOperation(
    @Param("id") id: string,
    @Body() d: ReasonDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.cancelOperation(id, d, u);
  }
  @Permissions("inventory.read") @Get("stocks") stocks(
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
  ) {
    return this.ledger.stocks(q, u);
  }
  @Permissions("reports.read") @Get("reports/:type") report(
    @Param("type") type: string,
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
  ) {
    return this.ledger.report(type, q, u);
  }
  @Permissions("reports.read") @Get("reports/:type/export") async export(
    @Param("type") type: string,
    @Query() q: LedgerQuery,
    @User() u: CurrentUser,
    @Res() res: Response,
  ) {
    const report = await this.ledger.report(type, q, u);
    const format = q.format ?? "csv";
    const content =
      format === "xlsx"
        ? await toXlsx(report.rows)
        : format === "pdf"
          ? await toPdf(report)
          : "\uFEFF" + toCsv(report.rows);
    res.setHeader(
      "Content-Type",
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "pdf"
          ? "application/pdf"
          : "text/csv; charset=utf-8",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bioflow-${type}.${format}"`,
    );
    res.send(content);
  }
  @Permissions("references.manage") @Post("archive/:entity/:id") archive(
    @Param("entity") entity: string,
    @Param("id") id: string,
    @Body() d: ReasonDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.archive(entity, id, d, u);
  }
  @Permissions("users.manage") @Post("users/:id/access") access(
    @Param("id") id: string,
    @Body() d: AccessDto,
    @User() u: CurrentUser,
  ) {
    return this.ledger.assignAccess(id, d, u);
  }
}
