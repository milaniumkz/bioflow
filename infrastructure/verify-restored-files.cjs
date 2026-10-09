const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync("/verification/manifest.json", "utf8"),
  );
  const client = new S3Client({
    endpoint: "http://s3:8333",
    forcePathStyle: true,
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = process.env.S3_BUCKET;
  const objects = new Map();
  let continuation;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuation,
      }),
    );
    for (const object of result.Contents || []) objects.set(object.Key, object);
    continuation = result.NextContinuationToken;
  } while (continuation);
  for (const expected of manifest) {
    const object = objects.get(expected.key);
    if (!object || object.Size !== expected.size)
      throw new Error("Restored file metadata mismatch");
  }
  let bytes = 0;
  const expectedChecksums = new Map(
    manifest.map((file) => [file.key, file.md5]),
  );
  for (const object of objects.values()) {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
    );
    const hash = crypto.createHash("md5");
    let size = 0;
    for await (const chunk of result.Body) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (size !== object.Size) throw new Error("Restored file length mismatch");
    const digest = hash.digest("hex");
    const expectedDigest = expectedChecksums.get(object.Key);
    if (expectedDigest && digest !== expectedDigest)
      throw new Error("Restored probe content mismatch");
    const etag = (object.ETag || "").replaceAll('"', "");
    if (/^[a-f\d]{32}$/i.test(etag) && digest !== etag)
      throw new Error("Restored file checksum mismatch");
    bytes += size;
  }
  client.destroy();
  console.log(
    JSON.stringify({
      status: "PASS",
      restoredObjects: objects.size,
      verifiedFileRecords: manifest.length,
      restoredBytes: bytes,
    }),
  );
}
main().catch(() => {
  console.error("Restored object-store verification failed");
  process.exitCode = 1;
});
