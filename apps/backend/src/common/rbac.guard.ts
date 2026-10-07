import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest();
    const path = request.originalUrl.split("?")[0].replace(/^\/api\/v1/, "");
    const actor = request.user;
    const legacyStockWrites =
      /^\/(washing-batches|production-batches|warehouse-transfers|transfers|write-offs|shipments|inventory\/corrections|waybills)(\/|$)/;
    if (request.method !== "GET" && legacyStockWrites.test(path))
      throw new ForbiddenException(
        "Используйте партийный учёт /ledger; старый маршрут не сохраняет происхождение",
      );
    if (
      !actor?.accessAllObjects &&
      !path.startsWith("/ledger") &&
      !path.startsWith("/auth") &&
      !path.startsWith("/files") &&
      ![
        "/warehouses",
        "/extraction-sites",
        "/counterparties",
        "/vehicles",
        "/drivers",
        "/material-types",
        "/product-types",
        "/reference-values",
        "/notifications",
      ].includes(path) &&
      !/^\/notifications\/[^/]+\/read$/.test(path)
    )
      throw new ForbiddenException(
        "Маршрут недоступен без объектных назначений; используйте /ledger",
      );
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user;
    if (required.every((permission) => user?.permissions?.includes(permission)))
      return true;
    throw new ForbiddenException("Insufficient permissions");
  }
}
