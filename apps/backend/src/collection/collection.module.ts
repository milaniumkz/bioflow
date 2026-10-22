import { Module } from "@nestjs/common";
import { LedgerModule } from "../ledger/ledger.module";
import {
  CollectionController,
  TrackingController,
} from "./collection.controller";
import { TrackingService } from "./tracking.service";
@Module({
  imports: [LedgerModule],
  controllers: [CollectionController, TrackingController],
  providers: [TrackingService],
})
export class CollectionModule {}
