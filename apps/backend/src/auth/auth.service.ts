import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDeviceDto, ResetPasswordDto } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email ?? undefined }, { phone: dto.phone ?? undefined }] }
    });
    if (!user || user.isBlocked || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.prisma.auditLog.create({
      data: { organizationId: user.organizationId, userId: user.id, action: "auth.login", entity: "User", entityId: user.id }
    });
    const deviceId = await this.upsertDevice(user.id, dto.deviceId, dto.platform, dto.pushToken);
    return this.issueTokens(user.id, user.organizationId, deviceId);
  }

  async refresh(refreshToken: string, deviceId?: string) {
    const tokenHash = await this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.user.isBlocked) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(stored.userId, stored.user.organizationId, deviceId ?? stored.deviceId ?? undefined);
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, fullName: true, mustChangePassword: true, organization: { select: { id: true, name: true } }, userRoles: { include: { role: true } } }
    });
    if (!user) throw new NotFoundException("User not found");
    return { ...user, roles: user.userRoles.map((userRole) => userRole.role.code), userRoles: undefined };
  }

  sessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, device: { select: { id: true, platform: true, lastSeenAt: true } } }
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const token = await this.prisma.refreshToken.findFirst({ where: { id: sessionId, userId } });
    if (!token) throw new NotFoundException("Session not found");
    await this.prisma.refreshToken.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const deviceId = await this.upsertDevice(userId, dto.deviceId, dto.platform, dto.pushToken);
    return this.prisma.device.findUnique({ where: { id: deviceId } });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new ForbiddenException("Current password is invalid");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(dto.newPassword), mustChangePassword: false }
      }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { organizationId: user.organizationId, userId, action: "auth.change-password", entity: "User", entityId: userId }
      })
    ]);
    return { ok: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email ?? undefined }, { phone: dto.phone ?? undefined }] }
    });
    if (!user || user.isBlocked) return { ok: true };
    const token = randomUUID();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: await this.hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        }
      }),
      this.prisma.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "auth.forgot-password", entity: "User", entityId: user.id }
      })
    ]);
    return { ok: true, resetToken: token };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = await this.hashToken(dto.token);
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!token || token.usedAt || token.expiresAt < new Date() || token.user.isBlocked) {
      throw new UnauthorizedException("Invalid reset token");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash: await argon2.hash(dto.newPassword), mustChangePassword: false }
      }),
      this.prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { organizationId: token.user.organizationId, userId: token.userId, action: "auth.reset-password", entity: "User", entityId: token.userId }
      })
    ]);
    return { ok: true };
  }

  private async issueTokens(userId: string, organizationId: string, deviceId?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, organizationId },
      { secret: process.env.JWT_ACCESS_SECRET ?? "dev-access", expiresIn: "15m" }
    );
    const refreshToken = randomUUID();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        deviceId,
        tokenHash: await this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    return { accessToken, refreshToken };
  }

  private async hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async upsertDevice(userId: string, deviceId?: string, platform?: string, pushToken?: string) {
    if (!deviceId && !platform && !pushToken) return undefined;
    if (deviceId) {
      const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId } });
      if (device) {
        await this.prisma.device.update({ where: { id: deviceId }, data: { platform: platform ?? device.platform, pushToken: pushToken ?? device.pushToken, lastSeenAt: new Date() } });
        return deviceId;
      }
    }
    const created = await this.prisma.device.create({
      data: { userId, platform: platform ?? "web", pushToken, lastSeenAt: new Date() }
    });
    return created.id;
  }
}
