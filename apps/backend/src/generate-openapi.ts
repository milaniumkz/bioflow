import { writeFileSync, mkdirSync } from "fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { createOpenApiDocument } from "./openapi";

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = createOpenApiDocument(app);
  mkdirSync("../../packages/api-client/openapi", { recursive: true });
  writeFileSync("../../packages/api-client/openapi/openapi.json", JSON.stringify(document, null, 2));
  await app.close();
}

main();
