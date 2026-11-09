import { CustomerDeliveryService } from "./customer-delivery";
import { OwnerDashboard } from "./owner-dashboard";
import { Module } from "@nestjs/common";
import { ProcessingController } from "./processing.controller";
import { ProcessingService } from "./processing.service";
@Module({
  controllers: [ProcessingController],
  providers: [ProcessingService, OwnerDashboard, CustomerDeliveryService],
})
export class ProcessingModule {}
