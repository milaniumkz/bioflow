import { Module } from "@nestjs/common";
import { ProcessingController } from "./processing.controller";
import { ProcessingService } from "./processing.service";
@Module({ controllers: [ProcessingController], providers: [ProcessingService] })
export class ProcessingModule {}
