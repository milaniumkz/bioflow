import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { AcceptWaybillDto, CreateWaybillDto, ResolveQrDto, UpdateWaybillStatusDto } from "./waybills.dto";
import { WaybillsService } from "./waybills.service";

@ApiTags("waybills")
@ApiBearerAuth()
@Controller()
export class WaybillsController {
  constructor(private readonly waybills: WaybillsService) {}

  @Permissions("waybills.manage")
  @Get("waybills")
  list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.list(query, user);
  }

  @Permissions("waybills.manage")
  @Post("waybills")
  create(@Body() dto: CreateWaybillDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.create(dto, user);
  }

  @Permissions("waybills.manage")
  @Get("waybills/by-number/:number")
  getByNumber(@Param("number") number: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.getByNumber(number, user);
  }

  @Permissions("waybills.manage")
  @Get("waybills/:id")
  getById(@Param("id") id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.getById(id, user);
  }

  @Permissions("waybills.manage")
  @Post("waybills/:id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateWaybillStatusDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.updateStatus(id, dto, user);
  }

  @Permissions("waybills.accept")
  @Post("qr/resolve")
  resolveQr(@Body() dto: ResolveQrDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.resolveQr(dto.token, user);
  }

  @Permissions("waybills.accept")
  @Post("waybills/:id/accept")
  accept(@Param("id") id: string, @Body() dto: AcceptWaybillDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.waybills.accept(id, dto, user);
  }
}
