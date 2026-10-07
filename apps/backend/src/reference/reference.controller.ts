import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import {
  AssignRolesDto,
  CreateReferenceDto,
  CreateUserDto,
  SetUserBlockedDto,
  UpdateReferenceDto,
  UpsertSettingDto,
} from "./reference.dto";
import { ReferenceService } from "./reference.service";

@ApiTags("references")
@ApiBearerAuth()
@Controller()
export class ReferenceController {
  constructor(private readonly references: ReferenceService) {}

  @Permissions("references.read")
  @Get(":entity")
  list(
    @Param("entity") entity: string,
    @Query() query: PageDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.list(entity, query, user);
  }

  @Permissions("users.manage")
  @Post("users")
  createUser(
    @Body() dto: CreateUserDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.createUser(dto, user);
  }

  @Permissions("users.manage")
  @Post("users/:id/roles")
  assignRoles(
    @Param("id") id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.assignRoles(id, dto.roleCodes, user);
  }

  @Permissions("users.manage")
  @Post("users/:id/block")
  setUserBlocked(
    @Param("id") id: string,
    @Body() dto: SetUserBlockedDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.setUserBlocked(id, dto.blocked, dto.reason, user);
  }

  @Permissions("references.manage")
  @Post("settings")
  upsertSetting(
    @Body() dto: UpsertSettingDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.upsertSetting(dto, user);
  }

  @Permissions("references.manage")
  @Post(":entity")
  create(
    @Param("entity") entity: string,
    @Body() dto: CreateReferenceDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.create(entity, dto.data, user);
  }

  @Permissions("references.manage")
  @Patch(":entity/:id")
  update(
    @Param("entity") entity: string,
    @Param("id") id: string,
    @Body() dto: UpdateReferenceDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.references.update(entity, id, dto.data, dto.reason, user);
  }
}
