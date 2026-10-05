import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Missing bearer token");
    const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET ?? "dev-access" });
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
    });
    if (!user || user.isBlocked) throw new UnauthorizedException("User is blocked or missing");
    request.user = {
      id: user.id,
      organizationId: user.organizationId,
      permissions: user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code))
    };
    return true;
  }
}
