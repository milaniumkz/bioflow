import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { CollectionAdminService } from "./collection-admin.service";
import {
  AdminBagStateDto,
  AdminBagsDto,
  AdminBlockDto,
  AdminCommandDto,
  AdminLocationDto,
  AdminNoticeDto,
  AdminPasswordDto,
  AdminSettingsDto,
  AdminStageDto,
  AdminStockDto,
  AdminTripDto,
  AdminUserDto,
} from "./collection-admin.dto";
@Controller("collection/admin")
export class CollectionAdminController {
  constructor(private readonly service: CollectionAdminService) {}
  @Get("state") state(@User() actor: CurrentUser) {
    return this.service.state(actor);
  }
  @Get("operations") operations(
    @User() actor: CurrentUser,
    @Query() query: PageDto,
  ) {
    return this.service.operations(actor, query);
  }
  @Get("export") export(@User() actor: CurrentUser) {
    return this.service.export(actor);
  }
  @Get("audit") history(@User() actor: CurrentUser, @Query() query: PageDto) {
    return this.service.history(actor, query);
  }
  @Get("notifications") notices(
    @User() actor: CurrentUser,
    @Query() query: PageDto,
  ) {
    return this.service.notices(actor, query);
  }
  @Post("users") createUser(
    @Body() dto: AdminUserDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.saveUser(undefined, dto, actor);
  }
  @Post("users/:id") saveUser(
    @Param("id") id: string,
    @Body() dto: AdminUserDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.saveUser(id, dto, actor);
  }
  @Post("users/:id/block") block(
    @Param("id") id: string,
    @Body() dto: AdminBlockDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.block(id, dto, actor);
  }
  @Post("users/:id/password") password(
    @Param("id") id: string,
    @Body() dto: AdminPasswordDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.password(id, dto, actor);
  }
  @Post("locations") createLocation(
    @Body() dto: AdminLocationDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.location(undefined, dto, actor);
  }
  @Post("locations/:id") location(
    @Param("id") id: string,
    @Body() dto: AdminLocationDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.location(id, dto, actor);
  }
  @Post("stock") stock(@Body() dto: AdminStockDto, @User() actor: CurrentUser) {
    return this.service.stock(dto, actor);
  }
  @Post("bags") bags(@Body() dto: AdminBagsDto, @User() actor: CurrentUser) {
    return this.service.addBags(dto, actor);
  }
  @Post("bags/:id") bag(
    @Param("id") id: string,
    @Body() dto: AdminBagStateDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.bag(id, dto, actor);
  }
  @Post("trips/:id") trip(
    @Param("id") id: string,
    @Body() dto: AdminTripDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.trip(id, dto, actor);
  }
  @Post("trips/:id/stage") stage(
    @Param("id") id: string,
    @Body() dto: AdminStageDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.stage(id, dto, actor);
  }
  @Post("trips/:id/stop") stop(
    @Param("id") id: string,
    @Body() dto: AdminCommandDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.stopDriver(id, dto, actor);
  }
  @Post("trips/:id/cancel") cancelTrip(
    @Param("id") id: string,
    @Body() dto: AdminCommandDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.cancelTrip(id, dto, actor);
  }
  @Post("shipments/:id/cancel") cancelShipment(
    @Param("id") id: string,
    @Body() dto: AdminCommandDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.cancelShipment(id, dto, actor);
  }
  @Post("operations/:id/reverse") reverse(
    @Param("id") id: string,
    @Body() dto: AdminCommandDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.reverse(id, dto, actor);
  }
  @Post("notifications") sendNotice(
    @Body() dto: AdminNoticeDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.sendNotice(dto, actor);
  }
  @Post("notifications/:id/retry") retryNotice(
    @Param("id") id: string,
    @Body() dto: AdminCommandDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.retryNotice(id, dto, actor);
  }
  @Post("settings") settings(
    @Body() dto: AdminSettingsDto,
    @User() actor: CurrentUser,
  ) {
    return this.service.settings(dto, actor);
  }
}
