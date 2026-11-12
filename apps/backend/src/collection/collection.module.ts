import {
  CollectionTestCleanupController,
  CollectionTestCleanupService,
} from "./collection-test-cleanup";
import {
  CollectionRegistrationController,
  CollectionRegistrationService,
} from "./collection-registration";
import { FileInterceptor } from "@nestjs/platform-express";
import { CollectionTutorialsService } from "./collection-tutorials.service";
import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
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
  CollectionWeightCorrectionDto,
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
  constructor(
    private readonly service: CollectionService,
    private readonly tutorials: CollectionTutorialsService,
  ) {}
  @Get("tutorials") videos(@User() user: CurrentUser) {
    return this.tutorials.list(user);
  }
  @Post("tutorials/chunks")
  @UseInterceptors(
    FileInterceptor("chunk", {
      limits: { fileSize: 1024 * 1024, files: 1, fields: 5 },
    }),
  )
  upload(
    @User() user: CurrentUser,
    @Body() body: Record<string, string>,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    return this.tutorials.upload(
      user,
      {
        filename: body.filename,
        uploadId: body.uploadId,
        index: Number(body.index),
        count: Number(body.count),
        sha256: body.sha256,
      },
      file?.buffer ?? Buffer.alloc(0),
    );
  }
  @Get("state") state(@User() user: CurrentUser) {
    return this.service.state(user);
  }
  @Post("trips/:id/weight")
  correctWeight(
    @Param("id") id: string,
    @Body() dto: CollectionWeightCorrectionDto,
    @User() user: CurrentUser,
  ) {
    return this.service.correctTripWeight(id, dto, user);
  }
  @Get("trips/:id/qr") qr(@Param("id") id: string, @User() user: CurrentUser) {
    return this.service.qr(id, user);
  }
  @Get("trips/:id/route") route(
    @Param("id") id: string,
    @User() user: CurrentUser,
    @Query("cursor") cursor?: string,
  ) {
    return this.service.route(id, user, cursor);
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
  constructor(
    private readonly service: CollectionDriverService,
    private readonly tutorials: CollectionTutorialsService,
  ) {}
  @Public() @Get("tutorials") videos() {
    return this.tutorials.list();
  }
  @Public() @Post("claim") claim(@Body() dto: ClaimDriverDto) {
    return this.service.claim(dto);
  }
  @Public() @Get("route") route(
    @Headers("authorization") token: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.service.route(token, cursor);
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
  controllers: [
    CollectionController,
    CollectionDriverController,
    CollectionRegistrationController,
    CollectionTestCleanupController,
  ],
  providers: [
    CollectionService,
    CollectionDriverService,
    CollectionTutorialsService,
    CollectionRegistrationService,
    CollectionTestCleanupService,
  ],
  exports: [CollectionService, CollectionDriverService],
})
export class CollectionModule {}
