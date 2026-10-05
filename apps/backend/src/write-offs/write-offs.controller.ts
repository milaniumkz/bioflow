import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { CreateWriteOffDto } from "./write-offs.dto";
import { WriteOffsService } from "./write-offs.service";

@ApiTags("write-offs")
@ApiBearerAuth()
@Controller("write-offs")
export class WriteOffsController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @Permissions("operations.manage")
  @Get()
  list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.writeOffs.list(query, user);
  }

  @Permissions("operations.manage")
  @Post()
  create(@Body() dto: CreateWriteOffDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.writeOffs.create(dto, user);
  }
}
