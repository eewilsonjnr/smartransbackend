import type { AuthorityUserRole, UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { AppError } from "../common/app-error";
import { asyncHandler } from "../common/async-handler";
import { env } from "../config/env";
import { prisma } from "../config/prisma";

type JwtPayload = {
  sub: string;
  role: UserRole;
};

const resolveAuthorityUserRole = (
  authorityUsers: Array<{ role: AuthorityUserRole }>,
): AuthorityUserRole | undefined => {
  if (authorityUsers.some((authorityUser) => authorityUser.role === "ADMIN")) {
    return "ADMIN";
  }

  return authorityUsers[0]?.role;
};

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw new AppError(401, "Authentication token is required.");
  }

  const token = header.slice("Bearer ".length);
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    include: {
      organizationUsers: true,
      authorityUsers: {
        where: { status: "ACTIVE" },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new AppError(401, "User account is not active.");
  }

  req.auth = {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    organizationIds: user.organizationUsers.map((orgUser) => orgUser.organizationId),
    authorityIds: user.authorityUsers.map((authorityUser) => authorityUser.authorityId),
    authorityUserRole: resolveAuthorityUserRole(user.authorityUsers),
  };

  next();
});

export const requireRoles =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError(401, "Authentication is required."));
    }

    if (!roles.includes(req.auth.role)) {
      return next(new AppError(403, "You do not have permission to perform this action."));
    }

    return next();
  };
