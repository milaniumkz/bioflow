import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("BIOFLOW API")
    .setDescription("Control of extraction, transport, acceptance, inventory, washing and production.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.paths = Object.fromEntries(Object.entries(document.paths).map(([path, value]) => [`/api/v1${path}`, value]));
  return document;
}

export function setupOpenApi(app: INestApplication) {
  SwaggerModule.setup("api/docs", app, createOpenApiDocument(app));
}
