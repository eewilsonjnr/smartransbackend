import type { Prisma, ViolationSeverity } from "@prisma/client";

import { AppError } from "../../common/app-error";
import { canReadSystem } from "../../utils/access";

const severityValues: ViolationSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const singleQueryValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return singleQueryValue(value[0]);
  }

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const parseDateFilter = (value: string, boundary: "start" | "end") => {
  const normalizedValue =
    boundary === "end" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `Invalid ${boundary}Date filter.`);
  }

  return date;
};

export const buildViolationWhere = (
  auth: Express.Request["auth"],
  query: Record<string, unknown>,
): Prisma.ViolationWhereInput => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  const where: Prisma.ViolationWhereInput = canReadSystem(auth.role)
    ? {}
    : auth.role === "DRIVER"
      ? { driver: { userId: auth.id } }
      : auth.role === "CAR_OWNER"
        ? { carOwner: { userId: auth.id } }
        : { organizationId: { in: auth.organizationIds } };

  const organizationId = singleQueryValue(query.organizationId);
  const driverId = singleQueryValue(query.driverId);
  const vehicleId = singleQueryValue(query.vehicleId);
  const severity = singleQueryValue(query.severity);
  const startDate = singleQueryValue(query.startDate);
  const endDate = singleQueryValue(query.endDate);

  if (organizationId) {
    if (!canReadSystem(auth.role) && !auth.organizationIds.includes(organizationId)) {
      throw new AppError(403, "You do not have access to this organization.");
    }
    where.organizationId = organizationId;
  }

  if (driverId) {
    where.driverId = driverId;
  }

  if (vehicleId) {
    where.vehicleId = vehicleId;
  }

  if (severity) {
    if (!severityValues.includes(severity as ViolationSeverity)) {
      throw new AppError(400, "Invalid severity filter.");
    }
    where.severity = severity as ViolationSeverity;
  }

  if (startDate || endDate) {
    const violationTime: Prisma.DateTimeFilter = {};

    if (startDate) {
      violationTime.gte = parseDateFilter(startDate, "start");
    }

    if (endDate) {
      violationTime.lte = parseDateFilter(endDate, "end");
    }

    where.violationTime = violationTime;
  }

  return where;
};
