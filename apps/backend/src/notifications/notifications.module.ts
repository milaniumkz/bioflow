import { DriverTrackingModule } from "../driver-tracking/driver-tracking.module";
import { Module } from "@nestjs/common";
import { DeliveryService } from "./delivery.service";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [DriverTrackingModule],
  controllers: [NotificationsController],
  providers: [DeliveryService],
})
export class NotificationsModule {}
