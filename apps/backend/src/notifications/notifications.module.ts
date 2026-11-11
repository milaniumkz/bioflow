import { Module } from "@nestjs/common";
import { DeliveryService } from "./delivery.service";
import { NotificationsController } from "./notifications.controller";

@Module({
  controllers: [NotificationsController],
  providers: [DeliveryService],
})
export class NotificationsModule {}
