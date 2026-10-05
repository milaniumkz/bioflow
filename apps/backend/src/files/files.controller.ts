import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { AttachFileDto, CreateUploadUrlDto } from "./files.dto";
import { FilesService } from "./files.service";

@ApiTags("files")
@ApiBearerAuth()
@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("upload-url")
  createUploadUrl(@Body() dto: CreateUploadUrlDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.files.createUploadUrl(dto, user);
  }

  @Get(":id/download-url")
  createDownloadUrl(@Param("id") id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.files.createDownloadUrl(id, user);
  }

  @Post("waybills/:waybillId")
  attachToWaybill(@Param("waybillId") waybillId: string, @Body() dto: AttachFileDto, @CurrentUserDecorator() user: CurrentUser) {
    return this.files.attachToWaybill(waybillId, dto.fileId, user);
  }
}
