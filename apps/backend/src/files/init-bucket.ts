import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import "dotenv/config";
const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: process.env.S3_ACCESS_KEY
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      }
    : undefined,
});
async function main() {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw Error("S3_BUCKET is required");
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch (e: any) {
    if (e.$metadata?.httpStatusCode !== 404) throw e;
    await s3.send(new CreateBucketCommand({ Bucket }));
  }
  const origins = (process.env.WEB_ORIGIN ?? "").split(",").filter(Boolean);
  if (origins.length)
    await s3.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["Content-Type", "x-amz-*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 600,
            },
          ],
        },
      }),
    );
  console.log("Private bucket and upload CORS ready");
}
main().finally(() => s3.destroy());
