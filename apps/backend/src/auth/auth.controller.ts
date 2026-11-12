import type { Request, Response } from "express";
import {
  assertBrowserOrigin,
  readBrowserCookie,
  setBrowserCookie,
  clearBrowserCookie,
} from "./browser-session";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
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
  MobileWebSessionDto,
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
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.platform === "web") assertBrowserOrigin(req);
    const tokens = await this.auth.login(dto);
    if (dto.platform === "web") {
      setBrowserCookie(req, res, tokens.refreshToken);
      return { ...tokens, browserSession: true };
    }
    return tokens;
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const browser = readBrowserCookie(req) === dto.refreshToken;
    if (browser) assertBrowserOrigin(req);
    const tokens = await this.auth.refresh(dto.refreshToken, dto.deviceId);
    if (browser) {
      setBrowserCookie(req, res, tokens.refreshToken);
      return { ...tokens, browserSession: true };
    }
    return tokens;
  }
  @Public()
  @Post("browser-session")
  @HttpCode(200)
  browserSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBrowserOrigin(req);
    res.setHeader("Cache-Control", "no-store");
    return this.auth.browserSession(readBrowserCookie(req));
  }
  @Public()
  @Post("browser-logout")
  @HttpCode(200)
  async browserLogout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBrowserOrigin(req);
    const token = readBrowserCookie(req);
    if (token) await this.auth.endBrowserSession(token);
    clearBrowserCookie(req, res);
    return { ok: true };
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
  @Post("mobile-web-session")
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["refreshToken"],
      properties: {
        refreshToken: {
          type: "string",
          writeOnly: true,
          description:
            "Действующий refresh token той же нативной сессии, что Bearer",
        },
      },
    },
  })
  mobileWebSession(
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: MobileWebSessionDto,
  ) {
    return this.auth.mobileWebSession(user, dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUserDecorator() user: CurrentUser) {
    return this.auth.me(user.id).then((profile) => ({
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
