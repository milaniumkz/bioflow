import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { HttpErrorFilter } from "./common/http-exception.filter";
import { assertProductionSecurityConfig, corsOriginConfig } from "./common/security-config";
import { setupOpenApi } from "./openapi";

async function bootstrap() {
  assertProductionSecurityConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({ origin: corsOriginConfig(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());

  setupOpenApi(app);

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

bootstrap();
