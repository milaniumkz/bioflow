import {
  Module,
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Param,
} from "@nestjs/common";
import { Public } from "../common/public.decorator";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { DriverTrackingService } from "./driver-tracking.service";
import { ClaimDriverDto, DriverPointsDto } from "./driver-tracking.dto";
@Controller("driver-tracking")
class DriverTrackingController {
  constructor(private readonly tracking: DriverTrackingService) {}
  @Public() @Post("claim") claim(@Body() dto: ClaimDriverDto) {
    return this.tracking.claim(
      dto.token,
      dto.clientToken,
      dto.plateNumber,
      dto.phone,
    );
  }
  @Public() @Post("points") points(
    @Headers("authorization") header: string,
    @Body() dto: DriverPointsDto,
  ) {
    return this.tracking.points(header, dto);
  }
  @Public() @Post("stop") stop(@Headers("authorization") header: string) {
    return this.tracking.stop(header);
  }
  @Get("waybills/:id") position(
    @Param("id") id: string,
    @User() user: CurrentUser,
  ) {
    return this.tracking.position(id, user);
  }
}
@Module({
  controllers: [DriverTrackingController],
  providers: [DriverTrackingService],
  exports: [DriverTrackingService],
})
export class DriverTrackingModule {}
