import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../common/app-error";
import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { assertOrganizationAccess, canReadSystem } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";

const createAssignmentSchema = z.object({
  driverId: z.string().min(1),
  vehicleId: z.string().min(1),
});

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

assignmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = canReadSystem(req.auth!.role)
      ? undefined
      : {
          OR: [
            { driver: { organizationId: { in: req.auth!.organizationIds } } },
            { vehicle: { organizationId: { in: req.auth!.organizationIds } } },
          ],
        };

    const assignments = await prisma.driverVehicleAssignment.findMany({
      where,
      include: {
        driver: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, phone: true },
            },
            organization: true,
          },
        },
        vehicle: {
          include: {
            carOwner: {
              include: {
                user: {
                  select: { id: true, fullName: true, email: true, phone: true },
                },
              },
            },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
    });

    res.json({ success: true, data: assignments });
  }),
);

assignmentsRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(createAssignmentSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createAssignmentSchema>;

    const [driver, vehicle] = await Promise.all([
      prisma.driver.findUniqueOrThrow({ where: { id: input.driverId } }),
      prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } }),
    ]);

    if (driver.organizationId !== vehicle.organizationId) {
      throw new AppError(400, "Driver and vehicle must belong to the same organization.");
    }

    assertOrganizationAccess(req.auth, driver.organizationId);

    const assignment = await prisma.$transaction(async (tx) => {
      await tx.driverVehicleAssignment.updateMany({
        where: {
          isActive: true,
          OR: [{ driverId: input.driverId }, { vehicleId: input.vehicleId }],
        },
        data: {
          isActive: false,
          unassignedAt: new Date(),
        },
      });

      const created = await tx.driverVehicleAssignment.create({
        data: {
          driverId: input.driverId,
          vehicleId: input.vehicleId,
        },
        include: {
          driver: { include: { user: true } },
          vehicle: true,
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "DRIVER_VEHICLE_ASSIGNED",
        entityType: "DriverVehicleAssignment",
        entityId: created.id,
        details: {
          driverId: input.driverId,
          vehicleId: input.vehicleId,
        },
      });

      return created;
    });

    res.status(201).json({ success: true, data: assignment });
  }),
);

assignmentsRouter.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  asyncHandler(async (req, res) => {
    const assignmentId = requiredParam(req, "id");
    const existing = await prisma.driverVehicleAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { driver: true },
    });

    assertOrganizationAccess(req.auth, existing.driver.organizationId);

    const assignment = await prisma.driverVehicleAssignment.update({
      where: { id: assignmentId },
      data: {
        isActive: false,
        unassignedAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "DRIVER_VEHICLE_UNASSIGNED",
      entityType: "DriverVehicleAssignment",
      entityId: assignment.id,
    });

    res.json({ success: true, data: assignment });
  }),
);
