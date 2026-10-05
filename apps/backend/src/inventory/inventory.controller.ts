import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { orderBy, PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCorrectionDto } from "./inventory.dto";
import { InventoryService } from "./inventory.service";

@ApiTags("inventory")
@ApiBearerAuth()
@Controller("inventory")
export class InventoryController {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService) {}

  @Permissions("inventory.read")
  @Get()
  async balances(@CurrentUserDecorator() user: CurrentUser) {
    return this.prisma.inventoryItem.findMany({ where: { warehouse: { organizationId: user.organizationId } }, include: { warehouse: true, materialType: true } });
  }

  @Permissions("inventory.read")
  @Get("movements")
  async movements(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.state) where.state = query.state;
    if (query.status) where.type = query.status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "type", "state", "quantity"]),
        include: { warehouse: true, materialType: true, productType: true, waybill: true }
      }),
      this.prisma.inventoryMovement.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  @Permissions("operations.manage")
  @Post("corrections")
  correction(@Body() dto: CreateCorrectionDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.inventory.correct(dto, user);
  }
}
