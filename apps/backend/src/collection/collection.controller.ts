import { ScanDto } from "../processing/processing.dto";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { Permissions } from "../common/permissions.decorator";
import { PageDto } from "../common/page.dto";
import { LedgerService } from "../ledger/ledger.service";
import {
  CollectionDto,
  CollectorDriverDto,
  CollectorVehicleDto,
  RoutePointsDto,
} from "./collection.dto";
import { TrackingService } from "./tracking.service";
class DriverStatusDto {
  @IsIn(["IN_TRANSIT", "ARRIVED"]) status!: "IN_TRANSIT" | "ARRIVED";
}
@ApiTags("collection")
@ApiBearerAuth()
@Controller("collection")
export class CollectionController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly tracking: TrackingService,
  ) {}
  @Permissions("collection.manage") @Post("dispatch") dispatch(
    @Body() dto: CollectionDto,
    @User() user: CurrentUser,
  ) {
    return this.ledger.createCollection(dto, user);
  }
  @Permissions("collection.manage") @Post("drivers") driver(
    @Body() dto: CollectorDriverDto,
    @User() user: CurrentUser,
  ) {
    return this.ledger.createCollectorDriver(dto, user);
  }
  @Permissions("collection.manage") @Post("vehicles") vehicle(
    @Body() dto: CollectorVehicleDto,
    @User() user: CurrentUser,
  ) {
    return this.ledger.createCollectorVehicle(dto, user);
  }
  @Permissions("tracking.read") @Get("trips") trips(
    @Query() query: PageDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.trips(user, query, false);
  }
}
@ApiTags("tracking")
@ApiBearerAuth()
@Controller("tracking")
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}
  @Permissions("tracking.write") @Post("scan") scan(
    @Body() dto: ScanDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.driverScan(dto.token, user);
  }
  @Permissions("tracking.write") @Get("trips") trips(
    @Query() query: PageDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.trips(user, query, true);
  }
  @Permissions("tracking.read") @Get("trips/:id/route") route(
    @Param("id") id: string,
    @Query() query: PageDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.route(id, query, user);
  }
  @Permissions("tracking.write") @Get("trips/:id/state") state(
    @Param("id") id: string,
    @User() user: CurrentUser,
  ) {
    return this.tracking.driverState(id, user);
  }
  @Permissions("tracking.write") @Post("trips/:id/points") points(
    @Param("id") id: string,
    @Body() dto: RoutePointsDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.positions(id, dto, user);
  }
  @Permissions("tracking.write") @Post("trips/:id/status") status(
    @Param("id") id: string,
    @Body() dto: DriverStatusDto,
    @User() user: CurrentUser,
  ) {
    return this.tracking.status(id, dto.status, user);
  }
}
