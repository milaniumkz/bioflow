import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface CurrentUser {
  id: string;
  organizationId: string;
  permissions: string[];
  roles?: string[];
  accessAllObjects?: boolean;
  counterpartyScopeId?: string | null;
  warehouseScopeIds?: string[];
  extractionScopeIds?: string[];
  deviceId?: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user as CurrentUser;
  },
);
