import { Router } from "express";

import { asyncHandler } from "../../common/async-handler";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

auditLogsRouter.get(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const action = typeof req.query.action === "string" ? req.query.action.trim() : undefined;
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType.trim() : undefined;
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : undefined;
    const startDate = typeof req.query.startDate === "string" ? new Date(req.query.startDate) : undefined;
    const endDate = typeof req.query.endDate === "string" ? new Date(`${req.query.endDate}T23:59:59.999Z`) : undefined;

    const where = {
      ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
      ...(entityType ? { entityType } : {}),
      ...(userId ? { userId } : {}),
      ...((startDate || endDate)
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    };

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, phone: true, role: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);
