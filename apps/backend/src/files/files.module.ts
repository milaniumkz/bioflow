import { LedgerModule } from "../ledger/ledger.module";
import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [LedgerModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
