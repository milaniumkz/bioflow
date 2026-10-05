import { Module } from "@nestjs/common";
import { WriteOffsController } from "./write-offs.controller";
import { WriteOffsService } from "./write-offs.service";

@Module({ controllers: [WriteOffsController], providers: [WriteOffsService] })
export class WriteOffsModule {}
