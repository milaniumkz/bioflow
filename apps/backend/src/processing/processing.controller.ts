import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import {
  BagReceiptDto,
  LaboratoryDto,
  PackDto,
  ProcessDto,
  ReceiveCollectionDto,
  ScanDto,
  SellDto,
} from "./processing.dto";
import { ProcessingService } from "./processing.service";
@ApiTags("processing")
@ApiBearerAuth()
@Controller("processing")
export class ProcessingController {
  constructor(private readonly service: ProcessingService) {}
  @Permissions("processing.overview") @Get("overview") overview(
    @User() u: CurrentUser,
  ) {
    return this.service.overview(u);
  }
  @Permissions("processing.read") @Post("scan") scan(
    @Body() dto: ScanDto,
    @User() u: CurrentUser,
  ) {
    return this.service.scan(dto.token, u);
  }
  @Permissions("laboratory.manage") @Post("laboratory") laboratory(
    @Body() dto: LaboratoryDto,
    @User() u: CurrentUser,
  ) {
    return this.service.laboratory(dto, u);
  }
  @Permissions("processing.receive") @Post("trips/:id/receive") receive(
    @Param("id") id: string,
    @Body() dto: ReceiveCollectionDto,
    @User() u: CurrentUser,
  ) {
    return this.service.receive(id, dto, u);
  }
  @Permissions("processing.read") @Post("runs") process(
    @Body() dto: ProcessDto,
    @User() u: CurrentUser,
  ) {
    return this.service.process(dto, u);
  }
  @Permissions("processing.dry") @Post("bags/:id/plant-intake") factoryIntake(
    @Param("id") id: string,
    @Body() dto: BagReceiptDto,
    @User() u: CurrentUser,
  ) {
    return this.service.factoryIntake(id, dto, u);
  }
  @Permissions("processing.finished") @Post("bags/:id/receive") receiveBag(
    @Param("id") id: string,
    @Body() dto: BagReceiptDto,
    @User() u: CurrentUser,
  ) {
    return this.service.receiveBag(id, dto, u);
  }
  @Permissions("processing.pack") @Post("bags/:id/pack") pack(
    @Param("id") id: string,
    @Body() dto: PackDto,
    @User() u: CurrentUser,
  ) {
    return this.service.pack(id, dto, u);
  }
  @Permissions("processing.sell") @Post("sales") sell(
    @Body() dto: SellDto,
    @User() u: CurrentUser,
  ) {
    return this.service.sell(dto, u);
  }
  @Permissions("processing.pack") @Get("packing-stats") stats(
    @Query("from") from: string,
    @Query("to") to: string,
    @User() u: CurrentUser,
  ) {
    return this.service.packingStats(u, from, to);
  }
  @Permissions("processing.read") @Get("trace/:id") trace(
    @Param("id") id: string,
    @User() u: CurrentUser,
  ) {
    return this.service.trace(id, u);
  }
}
