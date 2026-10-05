import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { orderBy, PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsService } from "./operations.service";
import { ProductionDto, WashingDto } from "./operations.dto";

@ApiTags("operations")
@ApiBearerAuth()
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService, private readonly prisma: PrismaService) {}

  @Permissions("operations.manage")
  @Post("washing-batches")
  washing(@Body() dto: WashingDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.operations.washing(dto, user);
  }

  @Permissions("operations.manage")
  @Get("washing-batches")
  async listWashing(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.status) where.status = query.status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.washingBatch.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "number", "status", "inputWeight", "outputWeight"])
      }),
      this.prisma.washingBatch.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  @Permissions("operations.manage")
  @Post("production-batches")
  production(@Body() dto: ProductionDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.operations.production(dto, user);
  }

  @Permissions("operations.manage")
  @Get("production-batches")
  async listProduction(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.status) where.status = query.status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.productionBatch.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "number", "status", "inputWeight", "outputWeight"])
      }),
      this.prisma.productionBatch.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }
}
