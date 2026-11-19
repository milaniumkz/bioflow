import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import {
  ChangePasswordDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDeviceDto,
  ResetPasswordDto,
} from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    if (!dto.email && !dto.phone)
      throw new UnauthorizedException("Email or phone is required");
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email ?? undefined },
          ...(dto.phone
            ? [
                { phone: dto.phone },
                { phone: dto.phone.replace(/^\+/, "") },
                ...(dto.phone.startsWith("+7")
                  ? [{ phone: "8" + dto.phone.slice(2) }]
                  : []),
              ]
            : []),
        ],
      },
    });
    if (
      !user ||
      user.isBlocked ||
      !(await argon2.verify(user.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "auth.login",
        entity: "User",
        entityId: user.id,
      },
    });
    const deviceId = await this.upsertDevice(
      user.id,
      dto.deviceId,
      dto.platform,
      dto.pushToken,
    );
    return this.issueTokens(user.id, user.organizationId, deviceId);
  }

  async refresh(refreshToken: string, deviceId?: string) {
    const tokenHash = await this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.user.isBlocked
    ) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (deviceId && stored.deviceId && deviceId !== stored.deviceId)
      throw new UnauthorizedException("Device mismatch");
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!claimed.count)
      throw new UnauthorizedException("Refresh token already used");
    return this.issueTokens(
      stored.userId,
      stored.user.organizationId,
      deviceId ?? stored.deviceId ?? undefined,
    );
  }

  async browserSession(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException("No browser session");
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: await this.hashToken(refreshToken) },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.user.isBlocked
    )
      throw new UnauthorizedException("Browser session expired");
    // A stable HttpOnly credential lets multiple tabs reload without racing token rotation.
    const accessToken = await this.jwt.signAsync(
      {
        sub: stored.userId,
        organizationId: stored.user.organizationId,
        deviceId: stored.deviceId ?? undefined,
        sessionId: stored.id,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
        expiresIn: "15m",
      },
    );
    return { accessToken, browserSession: true };
  }
  async endBrowserSession(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: await this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  async logoutAll(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.device.updateMany({
        where: { userId },
        data: { pushToken: null },
      }),
    ]);
    return { ok: true };
  }

  async deleteAccount(actor: CurrentUser, dto: DeleteAccountDto) {
    const unusablePassword = await argon2.hash(randomUUID());
    return this.prisma.$transaction(
      async (tx) => {
        // Use the same lock order as organization user administration.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":admin-users"},0))`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
        const user = await tx.user.findFirst({
          where: {
            id: actor.id,
            organizationId: actor.organizationId,
            deletedAt: null,
            isBlocked: false,
          },
        });
        if (
          !user ||
          dto.confirmation !== "DELETE" ||
          !(await argon2.verify(user.passwordHash, dto.currentPassword))
        )
          throw new ForbiddenException(
            "Подтвердите удаление действующим паролем",
          );
        const devices = await tx.device.findMany({
          where: { userId: user.id },
          select: { id: true },
        });
        const notices = await tx.notification.findMany({
          where: { userId: user.id },
          select: { id: true },
        });
        await tx.pushDelivery.deleteMany({
          where: {
            OR: [
              { deviceId: { in: devices.map((d) => d.id) } },
              { notificationId: { in: notices.map((n) => n.id) } },
            ],
          },
        });
        await tx.collectionNoticeLink.deleteMany({
          where: { notificationId: { in: notices.map((n) => n.id) } },
        });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.refreshToken.deleteMany({ where: { userId: user.id } });
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
        await tx.device.deleteMany({ where: { userId: user.id } });
        await tx.userRole.deleteMany({ where: { userId: user.id } });
        await tx.collectionMembership.deleteMany({
          where: { userId: user.id },
        });
        const deletedAt = new Date();
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: null,
            phone: null,
            fullName: "Deleted account",
            passwordHash: unusablePassword,
            isBlocked: true,
            deletedAt,
            mustChangePassword: false,
            accessAllObjects: false,
            counterpartyScopeId: null,
            warehouseScopeIds: [],
            extractionScopeIds: [],
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "auth.account-deleted",
            entity: "User",
            entityId: user.id,
            newValue: {
              deletedAt: deletedAt.toISOString(),
              profileRemoved: true,
              sessionsRemoved: true,
            },
          },
        });
        return { deleted: true, deletedAt: deletedAt.toISOString() };
      },
      { timeout: 15000 },
    );
  }

  // A separate session avoids sharing/rotating the native app's refresh token.
  // Actor identity comes only from the guarded bearer token, never request data.
  async mobileWebSession(user: CurrentUser, refreshToken: string) {
    const parent = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: await this.hashToken(refreshToken) },
    });
    // A short-lived access token alone must not mint a long-lived credential.
    if (
      !parent ||
      parent.userId !== user.id ||
      parent.id !== user.sessionId ||
      parent.revokedAt ||
      parent.expiresAt < new Date()
    ) {
      throw new UnauthorizedException(
        "Не удалось подтвердить сессию приложения",
      );
    }
    return this.issueTokens(user.id, user.organizationId);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        mustChangePassword: true,
        organization: { select: { id: true, name: true } },
        userRoles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return {
      ...user,
      roles: user.userRoles.map((userRole) => userRole.role.code),
      userRoles: undefined,
    };
  }

  sessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        device: { select: { id: true, platform: true, lastSeenAt: true } },
      },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const token = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId },
    });
    if (!token) throw new NotFoundException("Session not found");
    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const deviceId = await this.upsertDevice(
      userId,
      dto.deviceId,
      dto.platform,
      dto.pushToken,
    );
    return this.prisma.device.findUnique({ where: { id: deviceId } });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !(await argon2.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw new ForbiddenException("Current password is invalid");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId, deletedAt: null },
        data: {
          passwordHash: await argon2.hash(dto.newPassword),
          mustChangePassword: false,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId,
          action: "auth.change-password",
          entity: "User",
          entityId: userId,
        },
      }),
    ]);
    return { ok: true };
  }

  async adminReset(
    userId: string,
    temporaryPassword: string,
    reason: string,
    actor: import("../common/current-user.decorator").CurrentUser,
  ) {
    if (!actor.permissions.includes("users.manage"))
      throw new ForbiddenException("Недостаточно прав");
    const target = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: actor.organizationId,
        deletedAt: null,
      },
    });
    if (!target) throw new NotFoundException("Пользователь не найден");
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId, deletedAt: null },
        data: {
          passwordHash: await argon2.hash(temporaryPassword),
          mustChangePassword: true,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: "auth.admin-reset",
          entity: "User",
          entityId: userId,
          reason,
        },
      }),
    ]);
    return { ok: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    if (!dto.email && !dto.phone) return { ok: true };
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email ?? undefined },
          ...(dto.phone
            ? [
                { phone: dto.phone },
                { phone: dto.phone.replace(/^\+/, "") },
                ...(dto.phone.startsWith("+7")
                  ? [{ phone: "8" + dto.phone.slice(2) }]
                  : []),
              ]
            : []),
        ],
      },
    });
    if (!user || user.isBlocked) return { ok: true };
    const token = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      if (
        !(await tx.user.findFirst({
          where: { id: user.id, isBlocked: false, deletedAt: null },
        }))
      )
        return false;
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: await this.hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "auth.forgot-password",
          entity: "User",
          entityId: user.id,
        },
      });
      return true;
    });
    return created &&
      process.env.NODE_ENV === "test" &&
      process.env.ALLOW_TEST_RESET_TOKEN === "true"
      ? { ok: true, resetToken: token }
      : { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = await this.hashToken(dto.token);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !token ||
      token.usedAt ||
      token.expiresAt < new Date() ||
      token.user.isBlocked
    ) {
      throw new UnauthorizedException("Invalid reset token");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId, deletedAt: null },
        data: {
          passwordHash: await argon2.hash(dto.newPassword),
          mustChangePassword: false,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: token.user.organizationId,
          userId: token.userId,
          action: "auth.reset-password",
          entity: "User",
          entityId: token.userId,
        },
      }),
    ]);
    return { ok: true };
  }

  private async issueTokens(
    userId: string,
    organizationId: string,
    deviceId?: string,
  ) {
    const refreshToken = randomUUID();
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id: userId, isBlocked: false, deletedAt: null },
      });
      if (!user) throw new UnauthorizedException("User is blocked or deleted");
      return tx.refreshToken.create({
        data: {
          userId,
          deviceId,
          tokenHash: await this.hashToken(refreshToken),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, organizationId, deviceId, sessionId: session.id },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
        expiresIn: "15m",
      },
    );
    return { accessToken, refreshToken, deviceId };
  }

  private async hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async upsertDevice(
    userId: string,
    deviceId?: string,
    platform?: string,
    pushToken?: string,
  ) {
    if (!deviceId && !platform && !pushToken) return undefined;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (
        !(await tx.user.findFirst({
          where: { id: userId, isBlocked: false, deletedAt: null },
        }))
      )
        throw new UnauthorizedException("User is blocked or deleted");
      if (pushToken) {
        // One installation token belongs to one current account/device record.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"push:" + pushToken}, 0))`;
        await tx.device.updateMany({
          where: { pushToken },
          data: { pushToken: null },
        });
      }
      if (deviceId) {
        const device = await tx.device.findFirst({
          where: { id: deviceId, userId },
        });
        if (device) {
          await tx.device.update({
            where: { id: deviceId },
            data: {
              platform: platform ?? device.platform,
              pushToken: pushToken ?? device.pushToken,
              lastSeenAt: new Date(),
            },
          });
          return deviceId;
        }
      }
      const created = await tx.device.create({
        data: {
          userId,
          platform: platform ?? "web",
          pushToken,
          lastSeenAt: new Date(),
        },
      });
      return created.id;
    });
  }
}
