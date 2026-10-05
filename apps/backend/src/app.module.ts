import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ReferenceModule } from "./reference/reference.module";
import { WaybillsModule } from "./waybills/waybills.module";
import { InventoryModule } from "./inventory/inventory.module";
import { OperationsModule } from "./operations/operations.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ReportsModule } from "./reports/reports.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { FilesModule } from "./files/files.module";
import { AuditModule } from "./audit/audit.module";
import { TransfersModule } from "./transfers/transfers.module";
import { WriteOffsModule } from "./write-offs/write-offs.module";
import { ShipmentsModule } from "./shipments/shipments.module";
import { RbacGuard } from "./common/rbac.guard";
import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ReferenceModule,
    WaybillsModule,
    InventoryModule,
    OperationsModule,
    DashboardModule,
    ReportsModule,
    NotificationsModule,
    FilesModule,
    AuditModule,
    TransfersModule,
    WriteOffsModule,
    ShipmentsModule
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
