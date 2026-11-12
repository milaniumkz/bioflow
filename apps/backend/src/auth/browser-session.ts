import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
export function browserCookieOptions(req: Request) {
  const secure =
    req.secure ||
    req.headers["x-forwarded-proto"]?.toString().split(",")[0].trim() ===
      "https";
  return {
    name: secure ? "__Host-collection_web_session" : "collection_web_session",
    options: {
      httpOnly: true,
      secure,
      sameSite: "strict" as const,
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  };
}
export function readBrowserCookie(req: Request): string {
  const name = browserCookieOptions(req).name;
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
  try {
    return value && value.length <= 256 ? decodeURIComponent(value) : "";
  } catch {
    return "";
  }
}
export function assertBrowserOrigin(req: Request) {
  if (!req.headers.origin) return;
  const protocol = browserCookieOptions(req).options.secure ? "https" : "http";
  const allowed = [
    protocol + "://" + req.headers.host,
    ...(process.env.WEB_ORIGIN ?? "").split(","),
  ]
    .filter(Boolean)
    .map((v) => {
      try {
        return new URL(v).origin;
      } catch {
        return "";
      }
    });
  if (!allowed.includes(req.headers.origin))
    throw new ForbiddenException("Недопустимый источник запроса");
}
export function setBrowserCookie(req: Request, res: Response, token: string) {
  const config = browserCookieOptions(req);
  res.cookie(config.name, token, config.options);
  res.setHeader("Cache-Control", "no-store");
}
export function clearBrowserCookie(req: Request, res: Response) {
  const config = browserCookieOptions(req);
  res.cookie(config.name, "", { ...config.options, maxAge: 0 });
  res.setHeader("Cache-Control", "no-store");
}
