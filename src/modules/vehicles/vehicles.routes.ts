import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { assertOrganizationAccess, canReadSystem } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";

const createVehicleSchema = z.object({
  organizationId: z.string().min(1),
  carOwnerId: z.string().min(1),
  registrationNumber: z.string().min(3),
  vehicleType: z.string().min(2),
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
});

const updateVehicleSchema = z.object({
  vehicleType: z.string().min(2).optional(),
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "MAINTENANCE"]).optional(),
});

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

vehiclesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = canReadSystem(req.auth!.role)
      ? undefined
      : req.auth!.role === "CAR_OWNER"
        ? { carOwner: { userId: req.auth!.id } }
        : { organizationId: { in: req.auth!.organizationIds } };

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: {
        organization: true,
        carOwner: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        assignments: {
          where: { isActive: true },
          include: {
            driver: {
              include: {
                user: {
                  select: { id: true, fullName: true, email: true, phone: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: vehicles });
  }),
);

vehiclesRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(createVehicleSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createVehicleSchema>;
    assertOrganizationAccess(req.auth, input.organizationId);

    await prisma.carOwner.findUniqueOrThrow({ where: { id: input.carOwnerId } });

    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: input.organizationId,
        carOwnerId: input.carOwnerId,
        registrationNumber: input.registrationNumber.toUpperCase(),
        vehicleType: input.vehicleType,
        make: input.make,
        model: input.model,
        color: input.color,
      },
      include: {
        organization: true,
        carOwner: { include: { user: true } },
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "VEHICLE_CREATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
    });

    res.status(201).json({ success: true, data: vehicle });
  }),
);

vehiclesRouter.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(updateVehicleSchema),
  asyncHandler(async (req, res) => {
    const vehicleId = requiredParam(req, "id");
    const existing = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    assertOrganizationAccess(req.auth, existing.organizationId);

    const vehicle = await prisma.vehicle.update({
      where: { id: vehicleId },
      data: req.body as z.infer<typeof updateVehicleSchema>,
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "VEHICLE_UPDATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
    });

    res.json({ success: true, data: vehicle });
  }),
);
