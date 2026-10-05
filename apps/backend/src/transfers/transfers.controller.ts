import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { CancelTransferDto, CreateTransferDto } from "./transfers.dto";
import { TransfersService } from "./transfers.service";

@ApiTags("transfers")
@ApiBearerAuth()
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Permissions("operations.manage")
  @Get()
  list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.transfers.list(query, user);
  }

  @Permissions("operations.manage")
  @Post()
  create(@Body() dto: CreateTransferDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.transfers.create(dto, user);
  }

  @Permissions("operations.manage")
  @Post(":id/confirm")
  confirm(@Param("id") id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.transfers.confirm(id, user);
  }

  @Permissions("operations.manage")
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: CancelTransferDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.transfers.cancel(id, dto, user);
  }
}
