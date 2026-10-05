import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { CreateShipmentDto } from "./shipments.dto";
import { ShipmentsService } from "./shipments.service";

@ApiTags("shipments")
@ApiBearerAuth()
@Controller("shipments")
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Permissions("operations.manage")
  @Get()
  list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.shipments.list(query, user);
  }

  @Permissions("operations.manage")
  @Post()
  create(@Body() dto: CreateShipmentDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.shipments.create(dto, user);
  }
}
