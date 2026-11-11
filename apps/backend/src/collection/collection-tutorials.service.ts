import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import {
  assertCollectionDatabase,
  CollectionService,
} from "./collection.service";
import { CurrentUser } from "../common/current-user.decorator";
const filenamePattern =
  /^(?:(?:owner|collector|warehouse|factory|driver)--[a-z0-9-]{1,70}\.(?:mp4|vtt|srt|jpg)|collection-tutorials\.zip)$/;
@Injectable()
export class CollectionTutorialsService {
  constructor(private readonly collection: CollectionService) {}
  private get root() {
    return process.env.COLLECTION_TUTORIAL_DIR ?? "/tmp/collection-tutorials";
  }
  async list(user?: CurrentUser) {
    assertCollectionDatabase();
    const roles = user?.roles ?? [];
    if (user)
      this.collection.require(user, [
        "COLLECTOR",
        "WAREHOUSE_MANAGER",
        "FACTORY_MANAGER",
      ]);
    const prefixes = user
      ? roles
          .map(
            (r) =>
              ({
                OWNER: "owner",
                ADMIN: "owner",
                COLLECTOR: "collector",
                WAREHOUSE_MANAGER: "warehouse",
                FACTORY_MANAGER: "factory",
              })[r],
          )
          .filter(Boolean)
      : ["driver"];
    const names = await fs.readdir(this.root).catch(() => [] as string[]);
    return {
      videos: names
        .filter(
          (n) =>
            n.endsWith(".mp4") &&
            filenamePattern.test(n) &&
            prefixes.some((p) => n.startsWith(p + "--")),
        )
        .map((filename) => ({
          filename,
          url: "/downloads/tutorials/" + filename,
        })),
    };
  }
  async upload(
    user: CurrentUser,
    meta: {
      filename: string;
      uploadId: string;
      index: number;
      count: number;
      sha256: string;
    },
    data: Buffer,
  ) {
    this.collection.require(user);
    if (
      !filenamePattern.test(meta.filename) ||
      !/^\w[\w-]{15,63}$/.test(meta.uploadId) ||
      !Number.isInteger(meta.index) ||
      !Number.isInteger(meta.count) ||
      meta.count < 1 ||
      meta.count > 512 ||
      meta.index < 0 ||
      meta.index >= meta.count ||
      !/^[a-f0-9]{64}$/.test(meta.sha256) ||
      data.length > 1024 * 1024 ||
      !data.length
    )
      throw new BadRequestException("Некорректная часть видео");
    await fs.mkdir(this.root, { recursive: true, mode: 0o755 });
    const spool = join(this.root, ".incoming", meta.uploadId);
    await fs.mkdir(spool, { recursive: true, mode: 0o700 });
    const config = JSON.stringify({
      filename: meta.filename,
      count: meta.count,
      sha256: meta.sha256,
      userId: user.id,
    });
    try {
      await fs.writeFile(join(spool, "meta.json"), config, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if ((await fs.readFile(join(spool, "meta.json"), "utf8")) !== config)
        throw new ConflictException("Загрузка уже занята");
    }
    try {
      await fs.access(join(spool, "done"));
      return { complete: true, url: "/downloads/tutorials/" + meta.filename };
    } catch {}
    const part = join(spool, String(meta.index));
    try {
      await fs.writeFile(part, data, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (!(await fs.readFile(part)).equals(data))
        throw new ConflictException("Часть загрузки отличается");
    }
    if (meta.index !== meta.count - 1) return { complete: false };
    for (let i = 0; i < meta.count; i++) {
      try {
        await fs.access(join(spool, String(i)));
      } catch {
        return { complete: false };
      }
    }
    const lock = join(spool, "lock");
    try {
      await fs.writeFile(lock, "", { flag: "wx", mode: 0o600 });
    } catch {
      return { complete: false };
    }
    const temporary = join(this.root, "." + meta.uploadId + ".tmp");
    try {
      const output = await fs.open(temporary, "w", 0o644);
      const hash = createHash("sha256");
      try {
        for (let i = 0; i < meta.count; i++) {
          const chunk = await fs.readFile(join(spool, String(i)));
          hash.update(chunk);
          await output.writeFile(chunk);
        }
      } finally {
        await output.close();
      }
      if (hash.digest("hex") !== meta.sha256)
        throw new BadRequestException("Контрольная сумма видео не совпала");
      await fs.rename(temporary, join(this.root, meta.filename));
      return { complete: true, url: "/downloads/tutorials/" + meta.filename };
    } finally {
      await fs.rm(temporary, { force: true });
      await fs.rm(lock, { force: true });
    }
  }
}
