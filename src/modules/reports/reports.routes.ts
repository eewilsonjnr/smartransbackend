import { Router } from "express";

import { asyncHandler } from "../../common/async-handler";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { canReadSystem } from "../../utils/access";
import { buildViolationWhere } from "../violations/violation-filters";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get(
  "/summary",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "AUTHORITY"),
  asyncHandler(async (req, res) => {
    const organizationWhere = canReadSystem(req.auth!.role)
      ? undefined
      : { id: { in: req.auth!.organizationIds } };
    const organizationIdFilter = canReadSystem(req.auth!.role)
      ? undefined
      : { organizationId: { in: req.auth!.organizationIds } };
    const scopedFilter = organizationIdFilter ?? {};

    const [organizations, drivers, vehicles, trips, activeTrips, violations, criticalViolations, alerts] =
      await Promise.all([
        prisma.organization.count({ where: organizationWhere }),
        prisma.driver.count({ where: organizationIdFilter }),
        prisma.vehicle.count({ where: organizationIdFilter }),
        prisma.trip.count({ where: organizationIdFilter }),
        prisma.trip.count({ where: { ...scopedFilter, status: "IN_PROGRESS" } }),
        prisma.violation.count({ where: organizationIdFilter }),
        prisma.violation.count({ where: { ...scopedFilter, severity: "CRITICAL" } }),
        prisma.alert.count(),
      ]);

    res.json({
      success: true,
      data: {
        organizations,
        drivers,
        vehicles,
        trips,
        activeTrips,
        violations,
        criticalViolations,
        alerts,
      },
    });
  }),
);

const csvCell = (value: unknown) => {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

reportsRouter.get(
  "/violations.csv",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "AUTHORITY"),
  asyncHandler(async (req, res) => {
    const where = buildViolationWhere(req.auth, req.query as Record<string, unknown>);

    const violations = await prisma.violation.findMany({
      where,
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        organization: true,
        carOwner: { include: { user: true } },
      },
      orderBy: { violationTime: "desc" },
      take: 1000,
    });

    const header = [
      "violationId",
      "driver",
      "vehicle",
      "organization",
      "owner",
      "type",
      "severity",
      "speed",
      "speedLimit",
      "violationTime",
    ];
    const rows = violations.map((violation) => [
      violation.id,
      violation.driver.user.fullName,
      violation.vehicle.registrationNumber,
      violation.organization.name,
      violation.carOwner.user.fullName,
      violation.violationType,
      violation.severity,
      violation.speed,
      violation.speedLimit,
      violation.violationTime.toISOString(),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="smartrans-violations.csv"`);
    res.send(csv);
  }),
);
