import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Post,
} from "@nestjs/common";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { Public } from "../common/public.decorator";
import { ClaimDriverDto, DriverPointsDto } from "./collection-driver.dto";
import { CollectionService } from "./collection.service";
import { CollectionDriverService } from "./collection-driver.service";
import {
  CollectionGpTripDto,
  CollectionCommandDto,
  CollectionDriverEventDto,
  CollectionFactoryDto,
  CollectionProductionDto,
  CollectionShipmentDto,
  CollectionTripDto,
  CollectionWashDto,
} from "./collection.dto";
@Controller("collection")
class CollectionController {
  constructor(private readonly service: CollectionService) {}
  @Get("state") state(@User() user: CurrentUser) {
    return this.service.state(user);
  }
  @Get("trips/:id/qr") qr(@Param("id") id: string, @User() user: CurrentUser) {
    return this.service.qr(id, user);
  }
  @Post("gp-trips") gpTrip(
    @Body() dto: CollectionGpTripDto,
    @User() user: CurrentUser,
  ) {
    return this.service.gpTrip(dto, user);
  }
  @Post("trips") trip(
    @Body() dto: CollectionTripDto,
    @User() user: CurrentUser,
  ) {
    return this.service.createTrip(dto, user);
  }
  @Post("trips/:id/confirm") confirmTrip(
    @Param("id") id: string,
    @Body() dto: CollectionCommandDto,
    @User() user: CurrentUser,
  ) {
    return this.service.confirmTrip(id, dto.idempotencyKey, user);
  }
  @Post("wash") wash(
    @Body() dto: CollectionWashDto,
    @User() user: CurrentUser,
  ) {
    return this.service.wash(dto, user);
  }
  @Post("shipments") shipment(
    @Body() dto: CollectionShipmentDto,
    @User() user: CurrentUser,
  ) {
    return this.service.shipment(dto, user);
  }
  @Post("shipments/:id/confirm") confirmShipment(
    @Param("id") id: string,
    @Body() dto: CollectionCommandDto,
    @User() user: CurrentUser,
  ) {
    return this.service.confirmShipment(id, dto.idempotencyKey, user);
  }
  @Post("production") production(
    @Body() dto: CollectionProductionDto,
    @User() user: CurrentUser,
  ) {
    return this.service.production(dto, user);
  }
  @Post("factories") factory(
    @Body() dto: CollectionFactoryDto,
    @User() user: CurrentUser,
  ) {
    return this.service.factory(dto, user);
  }
}
@Controller("collection-driver")
class CollectionDriverController {
  constructor(private readonly service: CollectionDriverService) {}
  @Public() @Post("claim") claim(@Body() dto: ClaimDriverDto) {
    return this.service.claim(dto);
  }
  @Public() @Post("points") points(
    @Headers("authorization") token: string,
    @Body() dto: DriverPointsDto,
  ) {
    return this.service.points(token, dto);
  }
  @Public() @Post("events") event(
    @Headers("authorization") token: string,
    @Body() dto: CollectionDriverEventDto,
  ) {
    return this.service.event(token, dto);
  }
  @Public() @Post("stop") stop(@Headers("authorization") token: string) {
    return this.service.stop(token);
  }
}
@Module({
  controllers: [CollectionController, CollectionDriverController],
  providers: [CollectionService, CollectionDriverService],
  exports: [CollectionService, CollectionDriverService],
})
export class CollectionModule {}
