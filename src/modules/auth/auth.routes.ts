import type { AuthorityUserRole, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";

import { AppError } from "../../common/app-error";
import { asyncHandler } from "../../common/async-handler";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import {
  defaultPasswordForRole,
  hashPassword,
  signUserToken,
  verifyPassword,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  MAX_FAILED_LOGINS,
  LOCKOUT_MINUTES,
} from "../../utils/auth";
import { writeAuditLog } from "../../utils/audit";
import { canManageSystem } from "../../utils/access";

const optionalLoginIdentifier = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(3).optional(),
);

const loginSchema = z
  .object({
    identifier: optionalLoginIdentifier,
    email: optionalLoginIdentifier,
    phone: optionalLoginIdentifier,
    password: z.string().min(1),
  })
  .transform(({ identifier, email, phone, password }) => ({
    identifier: (identifier ?? email ?? phone ?? "").trim(),
    password,
  }))
  .refine(({ identifier }) => identifier.length >= 3, {
    path: ["identifier"],
    message: "Email, phone, or identifier is required.",
  });

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

const resetPasswordRequestSchema = z.object({
  identifier: z.string().min(3),
});

const ORG_ADMIN_RESET_ROLES: UserRole[] = ["ORG_ADMIN", "ORG_OFFICER", "DRIVER"];
const ORG_OFFICER_RESET_ROLES: UserRole[] = ["DRIVER"];
const AUTHORITY_ADMIN_RESET_ROLES: UserRole[] = ["AUTHORITY"];

const resolveAuthorityUserRole = (
  authorityUsers: Array<{ role: AuthorityUserRole }>,
): AuthorityUserRole | undefined => {
  if (authorityUsers.some((authorityUser) => authorityUser.role === "ADMIN")) {
    return "ADMIN";
  }

  return authorityUsers[0]?.role;
};

const canResetTargetPassword = (
  actor: NonNullable<Express.Request["auth"]>,
  targetRole: UserRole,
  targetOrganizationIds: string[],
  targetAuthorityIds: string[],
) => {
  if (canManageSystem(actor.role)) {
    return true;
  }

  if (actor.role === "AUTHORITY" && actor.authorityUserRole === "ADMIN") {
    const hasSharedAuthority = targetAuthorityIds.some((authorityId) =>
      actor.authorityIds.includes(authorityId),
    );
    return hasSharedAuthority && AUTHORITY_ADMIN_RESET_ROLES.includes(targetRole);
  }

  const hasSharedOrganization = targetOrganizationIds.some((organizationId) =>
    actor.organizationIds.includes(organizationId),
  );

  if (!hasSharedOrganization) {
    return false;
  }

  if (actor.role === "ORG_ADMIN") {
    return ORG_ADMIN_RESET_ROLES.includes(targetRole);
  }

  if (actor.role === "ORG_OFFICER") {
    return ORG_OFFICER_RESET_ROLES.includes(targetRole);
  }

  return false;
};

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

export const authRouter = Router();

authRouter.post(
  "/login",
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as z.infer<typeof loginSchema>;
    const ip = req.ip ?? req.socket.remoteAddress;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
      },
      include: {
        organizationUsers: true,
        authorityUsers: { where: { status: "ACTIVE" } },
      },
    });

    if (!user) {
      await prisma.loginAttempt.create({
        data: { identifier, ipAddress: ip, success: false },
      });
      throw new AppError(401, "Invalid login credentials.");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(
        403,
        `Account is locked due to too many failed attempts. Try again in ${remaining} minute(s).`,
      );
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);

    if (!passwordValid) {
      const newFailedCount = user.failedLoginCount + 1;
      const lockedUntil =
        newFailedCount >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : null;

      await Promise.all([
        prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: newFailedCount,
            ...(lockedUntil ? { lockedUntil } : {}),
          },
        }),
        prisma.loginAttempt.create({
          data: { identifier, ipAddress: ip, success: false },
        }),
      ]);

      if (lockedUntil) {
        throw new AppError(
          403,
          `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        );
      }

      throw new AppError(401, "Invalid login credentials.");
    }

    if (user.status !== "ACTIVE") {
      throw new AppError(403, "User account is not active.");
    }

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefreshToken);

    await Promise.all([
      prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.loginAttempt.create({
        data: { identifier, ipAddress: ip, success: true },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: refreshTokenExpiresAt(),
        },
      }),
    ]);

    const token = signUserToken(user);

    await writeAuditLog(prisma, {
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });

    res.json({
      success: true,
      token,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        organizationIds: user.organizationUsers.map((orgUser) => orgUser.organizationId),
        authorityIds: user.authorityUsers.map((authorityUser) => authorityUser.authorityId),
        authorityUserRole: resolveAuthorityUserRole(user.authorityUsers),
      },
    });
  }),
);

authRouter.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const tokenHash = hashRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            organizationUsers: true,
            authorityUsers: { where: { status: "ACTIVE" } },
          },
        },
      },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, "Invalid or expired refresh token.");
    }

    if (stored.user.status !== "ACTIVE") {
      throw new AppError(403, "User account is not active.");
    }

    const rawNewRefreshToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(rawNewRefreshToken);

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: newTokenHash,
          expiresAt: refreshTokenExpiresAt(),
        },
      }),
    ]);

    const token = signUserToken(stored.user);

    res.json({
      success: true,
      token,
      refreshToken: rawNewRefreshToken,
    });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const refreshToken = req.headers["x-refresh-token"] as string | undefined;

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, userId: req.auth!.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await writeAuditLog(prisma, {
      userId: req.auth!.id,
      action: "LOGOUT",
      entityType: "User",
      entityId: req.auth!.id,
    });

    res.json({ success: true, message: "Logged out successfully." });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.id } });

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError(401, "Current password is incorrect.");
    }

    const passwordHash = await hashPassword(newPassword);

    await Promise.all([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await writeAuditLog(prisma, {
      userId: user.id,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: user.id,
    });

    res.json({ success: true, message: "Password changed. Please log in again." });
  }),
);

// Staff and organization-initiated password reset.
authRouter.post(
  "/reset-password",
  requireAuth,
  validateBody(resetPasswordRequestSchema),
  asyncHandler(async (req, res) => {
    const { identifier } = req.body as z.infer<typeof resetPasswordRequestSchema>;

    if (
      !canManageSystem(req.auth!.role) &&
      req.auth!.role !== "ORG_ADMIN" &&
      req.auth!.role !== "ORG_OFFICER" &&
      !(req.auth!.role === "AUTHORITY" && req.auth!.authorityUserRole === "ADMIN")
    ) {
      throw new AppError(403, "You do not have permission to reset passwords.");
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
      },
      include: {
        organizationUsers: true,
        authorityUsers: { where: { status: "ACTIVE" } },
      },
    });

    if (!user) {
      res.json({ success: true, message: "If the account exists, a reset has been applied." });
      return;
    }

    const targetOrganizationIds = user.organizationUsers.map((orgUser) => orgUser.organizationId);
    const targetAuthorityIds = user.authorityUsers.map((authorityUser) => authorityUser.authorityId);
    if (!canResetTargetPassword(req.auth!, user.role, targetOrganizationIds, targetAuthorityIds)) {
      throw new AppError(403, "You do not have permission to reset this account.");
    }

    const tempPassword = defaultPasswordForRole(user.role);
    const passwordHash = await hashPassword(tempPassword);

    await Promise.all([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await writeAuditLog(prisma, {
      userId: req.auth!.id,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: user.id,
      details: { resetBy: req.auth!.id, targetRole: user.role },
    });

    res.json({
      success: true,
      message: "Password has been reset.",
      temporaryPassword: tempPassword,
    });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ success: true, user: req.auth });
  }),
);

const pushTokenSchema = z.object({
  pushToken: z.string().min(1).max(512),
});

authRouter.patch(
  "/push-token",
  requireAuth,
  validateBody(pushTokenSchema),
  asyncHandler(async (req, res) => {
    const { pushToken } = req.body as z.infer<typeof pushTokenSchema>;

    await prisma.user.update({
      where: { id: req.auth!.id },
      data: { pushToken },
    });

    res.json({ success: true, message: "Push token registered." });
  }),
);
