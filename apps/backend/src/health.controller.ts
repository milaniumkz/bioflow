import { Controller, Get } from "@nestjs/common";
import { checkRedis } from "./common/redis-health";
import { Public } from "./common/public.decorator";
import { PrismaService } from "./prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    const redis = await checkRedis();
    return { status: redis.configured && !redis.ok ? "degraded" : "ok", checks: { database: true, redis }, time: new Date().toISOString() };
  }
}
