import { Router } from "express";

import { asyncHandler } from "../../common/async-handler";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { buildViolationWhere } from "./violation-filters";

export const violationsRouter = Router();

violationsRouter.use(requireAuth);

violationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = buildViolationWhere(req.auth, req.query as Record<string, unknown>);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, violations] = await Promise.all([
      prisma.violation.count({ where }),
      prisma.violation.findMany({
        where,
        include: {
          driver: { include: { user: true } },
          vehicle: true,
          organization: true,
          carOwner: { include: { user: true } },
          trip: true,
        },
        orderBy: { violationTime: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      data: violations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

violationsRouter.get(
  "/repeat-offenders",
  asyncHandler(async (req, res) => {
    const where = buildViolationWhere(req.auth, req.query as Record<string, unknown>);

    const grouped = await prisma.violation.groupBy({
      by: ["driverId"],
      where,
      _count: { _all: true },
      _max: { violationTime: true },
      orderBy: { _count: { driverId: "desc" } },
      take: 25,
    });

    const drivers = await prisma.driver.findMany({
      where: { id: { in: grouped.map((row) => row.driverId) } },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        organization: true,
      },
    });

    const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

    res.json({
      success: true,
      data: grouped.map((row) => ({
        driver: driverMap.get(row.driverId),
        violationCount: row._count._all,
        lastViolationAt: row._max.violationTime,
      })),
    });
  }),
);
