export function assertCollectionDatabase() {
  if (process.env.COLLECTION_ENABLED !== "true")
    throw new Error("Collection bootstrap requires COLLECTION_ENABLED=true");
  const name = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  if (
    !name.startsWith("collection_") ||
    (process.env.COLLECTION_DATABASE_NAME &&
      name !== process.env.COLLECTION_DATABASE_NAME)
  )
    throw new Error(
      "Collection bootstrap refused: database must be its dedicated collection_* database",
    );
}
