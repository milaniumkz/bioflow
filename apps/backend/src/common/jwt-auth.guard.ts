import {
  ForbiddenException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Missing bearer token");
    let payload: { sessionId?: string; sub: string; deviceId?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired bearer token");
    }
    if (payload.sessionId) {
      const session = await this.prisma.refreshToken.findFirst({
        where: {
          id: payload.sessionId,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) throw new UnauthorizedException("Session revoked");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!user || user.isBlocked)
      throw new UnauthorizedException("User is blocked or missing");
    const path = request.originalUrl.split("?")[0].replace(/^\/api\/v1/, "");
    if (
      user.mustChangePassword &&
      ![
        "/auth/me",
        "/auth/change-password",
        "/auth/logout-all",
        "/auth/sessions",
      ].includes(path)
    )
      throw new ForbiddenException(
        "Смените временный пароль перед началом работы",
      );
    request.user = {
      id: user.id,
      roles: user.userRoles.map((ur) => ur.role.code),
      accessAllObjects:
        user.accessAllObjects ||
        user.userRoles.some((ur) => ["OWNER", "ADMIN"].includes(ur.role.code)),
      counterpartyScopeId: user.counterpartyScopeId,
      warehouseScopeIds: user.warehouseScopeIds,
      extractionScopeIds: user.extractionScopeIds,
      deviceId: payload.deviceId,
      organizationId: user.organizationId,
      permissions: user.userRoles.flatMap((ur) =>
        ur.role.permissions.map((rp) => rp.permission.code),
      ),
    };
    return true;
  }
}
