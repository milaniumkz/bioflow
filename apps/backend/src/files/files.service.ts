import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { CurrentUser } from "../common/current-user.decorator";
import { LedgerService } from "../ledger/ledger.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUploadUrlDto } from "./files.dto";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

@Injectable()
export class FilesService implements OnModuleDestroy {
  private readonly s3 = new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: process.env.S3_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY ?? "",
        }
      : undefined,
  });
  private readonly publicS3 = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(
      process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
    ),
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: process.env.S3_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY ?? "",
        }
      : undefined,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleDestroy() {
    this.s3.destroy();
    this.publicS3.destroy();
  }

  async createUploadUrl(dto: CreateUploadUrlDto, user: CurrentUser) {
    if (!ALLOWED_MIME.has(dto.mimeType))
      throw new BadRequestException("Unsupported file type");
    const bucket = this.bucket();
    const extension = safeExtension(dto.fileName);
    const key = `${user.organizationId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    const file = await this.prisma.file.create({
      data: {
        organizationId: user.organizationId,
        createdById: user.id,
        key,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        size: dto.size,
      },
    });
    if (dto.waybillId) await this.attachToWaybill(dto.waybillId, file.id, user);
    const uploadUrl = await getSignedUrl(
      this.publicS3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: dto.mimeType,
      }),
      { expiresIn: 600 },
    );
    return { file, uploadUrl, method: "PUT", expiresIn: 600 };
  }

  async createDownloadUrl(id: string, user: CurrentUser) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!file) throw new NotFoundException("File not found");
    if (!user.accessAllObjects) {
      if (file.entityId && file.entityType)
        await this.ledger.accessibleEntity(
          file.entityType,
          file.entityId,
          user,
        );
      else if (file.createdById !== user.id)
        throw new NotFoundException("File not found");
    }
    if (!file.verifiedAt)
      throw new BadRequestException("Upload is not complete");
    const downloadUrl = await getSignedUrl(
      this.publicS3,
      new GetObjectCommand({ Bucket: this.bucket(), Key: file.key }),
      { expiresIn: 300 },
    );
    return { file, downloadUrl, expiresIn: 300 };
  }

  async attachToWaybill(waybillId: string, fileId: string, user: CurrentUser) {
    const [waybill, file] = await Promise.all([
      this.prisma.waybill.findFirst({
        where: { id: waybillId, organizationId: user.organizationId },
      }),
      this.prisma.file.findFirst({
        where: { id: fileId, organizationId: user.organizationId },
      }),
    ]);
    if (!user.accessAllObjects)
      await this.ledger.accessibleEntity("Waybill", waybillId, user);
    if (!waybill) throw new NotFoundException("Waybill not found");
    if (!file) throw new NotFoundException("File not found");
    return this.prisma.waybillFile.upsert({
      where: { waybillId_fileId: { waybillId, fileId } },
      update: {},
      create: { waybillId, fileId },
    });
  }

  async completeUpload(id: string, user: CurrentUser) {
    const file = await this.prisma.file.findFirst({
      where: { id, organizationId: user.organizationId, createdById: user.id },
    });
    if (!file) throw new NotFoundException("File not found");
    const head = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket(), Key: file.key }),
    );
    if (head.ContentLength !== file.size || head.ContentType !== file.mimeType)
      throw new BadRequestException(
        "Uploaded content does not match declared size/type",
      );
    return this.prisma.file.update({
      where: { id },
      data: { verifiedAt: new Date() },
    });
  }

  private bucket() {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new BadRequestException("S3_BUCKET is not configured");
    return bucket;
  }
}

function safeExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match?.[0] ?? "";
}
