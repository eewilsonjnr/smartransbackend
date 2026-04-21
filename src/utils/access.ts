import type { UserRole } from "@prisma/client";

import { AppError } from "../common/app-error";

const SYSTEM_ROLES: UserRole[] = ["SUPER_ADMIN", "STAFF"];
const READ_ALL_ROLES: UserRole[] = ["SUPER_ADMIN", "STAFF", "AUTHORITY"];

export const canManageSystem = (role: UserRole) => SYSTEM_ROLES.includes(role);

export const canReadSystem = (role: UserRole) => READ_ALL_ROLES.includes(role);

export const assertOrganizationAccess = (
  auth: Express.Request["auth"],
  organizationId: string,
  options: { allowAuthority?: boolean } = {},
) => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  if (canManageSystem(auth.role) || (options.allowAuthority && auth.role === "AUTHORITY")) {
    return;
  }

  if (!auth.organizationIds.includes(organizationId)) {
    throw new AppError(403, "You do not have access to this organization.");
  }
};

export const organizationScope = (auth: Express.Request["auth"], options: { allowAuthority?: boolean } = {}) => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  if (canManageSystem(auth.role) || (options.allowAuthority && auth.role === "AUTHORITY")) {
    return undefined;
  }

  return { id: { in: auth.organizationIds } };
};

export const assertAuthorityAccess = (auth: Express.Request["auth"], authorityId: string) => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  if (canManageSystem(auth.role)) {
    return;
  }

  if (auth.role === "AUTHORITY" && auth.authorityIds.includes(authorityId)) {
    return;
  }

  throw new AppError(403, "You do not have access to this authority.");
};

export const authorityScope = (auth: Express.Request["auth"]) => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  if (canManageSystem(auth.role)) {
    return undefined;
  }

  if (auth.role === "AUTHORITY") {
    return { id: { in: auth.authorityIds } };
  }

  throw new AppError(403, "You do not have access to authorities.");
};
