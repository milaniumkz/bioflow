import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Public } from "../common/public.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./auth.dto";
const cookieName = "bioflow_refresh";
export function assertBrowserOrigin(req: Request) {
  const origin = req.headers.origin;
  const allowed = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());
  let parsed: URL | undefined;
  try {
    parsed = origin ? new URL(origin) : undefined;
  } catch {}
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
  )
    throw new ForbiddenException("Invalid browser origin");
  if (!allowed.includes(origin!) && parsed.host !== req.headers.host)
    throw new ForbiddenException("Invalid browser origin");
}
export function browserRefreshCookie(req: Request) {
  const value = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!value || value.length > 512) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
@Public()
@Controller("auth")
export class BrowserAuthController {
  constructor(private readonly auth: AuthService) {}
  private options() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/api/v1/auth",
    };
  }
  private issue(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    res.setHeader("Cache-Control", "no-store");
    res.cookie(cookieName, tokens.refreshToken, {
      ...this.options(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { accessToken: tokens.accessToken };
  }
  @Post("browser-login") async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBrowserOrigin(req);
    return this.issue(res, await this.auth.login(dto));
  }
  @Post("browser-refresh") async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBrowserOrigin(req);
    const token = browserRefreshCookie(req);
    if (!token) throw new UnauthorizedException("Missing browser session");
    try {
      return this.issue(res, await this.auth.refresh(token));
    } catch (error) {
      if (error instanceof UnauthorizedException)
        res.clearCookie(cookieName, this.options());
      throw error;
    }
  }
  @Post("browser-logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBrowserOrigin(req);
    res.clearCookie(cookieName, this.options());
    res.setHeader("Cache-Control", "no-store");
    const token = browserRefreshCookie(req);
    if (token) await this.auth.revokeRefresh(token);
    return { ok: true };
  }
}
