import { ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard } from "@nestjs/throttler";
import { IS_PUBLIC_KEY } from "./public.decorator";

const jwt = new JwtService();
export function throttleIdentity(
  header: string | undefined,
  ip: string,
  isPublic: boolean,
) {
  if (!isPublic && header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
      });
      if (typeof payload.sub === "string" && payload.sub)
        return `user:${payload.sub}`;
    } catch {}
  }
  return ip;
}

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected generateKey(
    context: ExecutionContext,
    tracker: string,
    name: string,
  ) {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const request = context.switchToHttp().getRequest();
    return super.generateKey(
      context,
      `${throttleIdentity(request.headers.authorization, tracker, isPublic)}:${request.route?.path ?? ""}`,
      name,
    );
  }
}
