import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface CurrentUser {
  id: string;
  organizationId: string;
  permissions: string[];
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as CurrentUser;
});
