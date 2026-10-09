const fs = require("node:fs");
const crypto = require("node:crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

async function main() {
  // This alias exists only inside the disposable verification network.
  const client = new S3Client({
    endpoint: "http://s3:8333",
    forcePathStyle: true,
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = `restore-verification/${crypto.randomUUID()}.txt`;
  const body = Buffer.from("BIOFLOW disposable restore probe v1\n");
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "text/plain",
    }),
  );
  fs.writeFileSync(
    "/verification/manifest.json",
    JSON.stringify([
      {
        key,
        size: body.length,
        md5: crypto.createHash("md5").update(body).digest("hex"),
      },
    ]),
  );
  client.destroy();
  console.log(
    "Disposable file probe created; working object store was not accessed",
  );
}
main().catch(() => {
  console.error("Disposable restore probe creation failed");
  process.exitCode = 1;
});
