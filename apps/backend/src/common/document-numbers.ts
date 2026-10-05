import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

type TxWithSettings = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T>;
};

export async function nextDocumentNumber(tx: TxWithSettings, organizationId: string, code: string) {
  const key = `sequence.${code}`;
  const id = randomUUID();
  const rows = await tx.$queryRaw<Array<{ value: unknown }>>(Prisma.sql`
    INSERT INTO "SystemSetting" ("id", "organizationId", "key", "value")
    VALUES (${id}, ${organizationId}, ${key}, to_jsonb(1))
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "value" = to_jsonb((("SystemSetting"."value"#>>'{}')::int + 1))
    RETURNING "value"
  `);
  const next = Number(rows[0]?.value ?? 1);
  return `${code}-${String(next).padStart(6, "0")}`;
}
