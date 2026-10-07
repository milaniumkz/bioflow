import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { Public } from "../common/public.decorator";
import { Permissions } from "../common/permissions.decorator";
import { AdminResetDto } from "./admin-reset.dto";
import { AuthService } from "./auth.service";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDeviceDto,
  ResetPasswordDto,
} from "./auth.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken, dto.deviceId);
  }

  @Public()
  @Post("forgot-password")
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Permissions("users.manage")
  @Post("users/:id/reset-password")
  adminReset(
    @Param("id") id: string,
    @Body() dto: AdminResetDto,
    @CurrentUserDecorator() actor: CurrentUser,
  ) {
    return this.auth.adminReset(id, dto.temporaryPassword, dto.reason, actor);
  }

  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUserDecorator() user: CurrentUser) {
    return this.auth
      .me(user.id)
      .then((profile) => ({
        ...profile,
        permissions: user.permissions,
        accessAllObjects: user.accessAllObjects,
        warehouseScopeIds: user.warehouseScopeIds,
        extractionScopeIds: user.extractionScopeIds,
        counterpartyScopeId: user.counterpartyScopeId,
      }));
  }

  @ApiBearerAuth()
  @Get("sessions")
  sessions(@CurrentUserDecorator() user: CurrentUser) {
    return this.auth.sessions(user.id);
  }

  @ApiBearerAuth()
  @Post("devices")
  registerDevice(
    @Body() dto: RegisterDeviceDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.auth.registerDevice(user.id, dto);
  }

  @ApiBearerAuth()
  @Post("sessions/:id/revoke")
  revokeSession(
    @Param("id") id: string,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.auth.revokeSession(user.id, id);
  }

  @ApiBearerAuth()
  @Post("change-password")
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.auth.changePassword(user.id, dto);
  }

  @ApiBearerAuth()
  @Post("logout-all")
  logoutAll(@CurrentUserDecorator() user: CurrentUser) {
    return this.auth.logoutAll(user.id);
  }
}
