import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../common/app-error";
import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { canReadSystem } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";
import { DEFAULT_CAR_OWNER_PASSWORD, hashPassword } from "../../utils/auth";

const optionalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(6, "Password must be at least 6 characters.").optional(),
);

const createCarOwnerSchema = z
  .object({
    fullName: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional(),
    password: optionalPasswordSchema,
    address: z.string().min(2).optional(),
  })
  .refine((value) => value.email || value.phone, {
    message: "Car owner requires an email or phone.",
    path: ["email"],
  });

const updateCarOwnerSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  address: z.string().min(2).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

export const carOwnersRouter = Router();

carOwnersRouter.use(requireAuth);

carOwnersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = canReadSystem(req.auth!.role)
      ? undefined
      : {
          vehicles: {
            some: {
              organizationId: { in: req.auth!.organizationIds },
            },
          },
        };

    const owners = await prisma.carOwner.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        _count: { select: { vehicles: true, trips: true, violations: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: owners });
  }),
);

carOwnersRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(createCarOwnerSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createCarOwnerSchema>;

    const owner = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? DEFAULT_CAR_OWNER_PASSWORD),
          role: "CAR_OWNER",
        },
      });

      const carOwner = await tx.carOwner.create({
        data: {
          userId: user.id,
          address: input.address,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              role: true,
            },
          },
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "CAR_OWNER_CREATED",
        entityType: "CarOwner",
        entityId: carOwner.id,
      });

      return carOwner;
    });

    res.status(201).json({ success: true, data: owner });
  }),
);

carOwnersRouter.patch(
  "/:id",
  validateBody(updateCarOwnerSchema),
  asyncHandler(async (req, res) => {
    const carOwnerId = requiredParam(req, "id");
    const input = req.body as z.infer<typeof updateCarOwnerSchema>;

    const existing = await prisma.carOwner.findUniqueOrThrow({
      where: { id: carOwnerId },
      include: { vehicles: true },
    });

    if (req.auth!.role === "CAR_OWNER") {
      if (existing.userId !== req.auth!.id) {
        throw new AppError(403, "Owners can only update their own profile.");
      }
    } else if (!canReadSystem(req.auth!.role)) {
      const hasOrganizationAccess = existing.vehicles.some((vehicle) =>
        req.auth!.organizationIds.includes(vehicle.organizationId),
      );

      if (!hasOrganizationAccess) {
        throw new AppError(403, "You do not have access to this car owner.");
      }
    }

    if (!["SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "CAR_OWNER"].includes(req.auth!.role)) {
      throw new AppError(403, "You do not have permission to update car owners.");
    }

    const owner = await prisma.$transaction(async (tx) => {
      if (input.fullName || input.email || input.phone || input.status) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            fullName: input.fullName,
            email: input.email?.toLowerCase(),
            phone: input.phone,
            status: input.status,
          },
        });
      }

      const updated = await tx.carOwner.update({
        where: { id: carOwnerId },
        data: {
          address: input.address,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              status: true,
            },
          },
          _count: { select: { vehicles: true, trips: true, violations: true } },
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "CAR_OWNER_UPDATED",
        entityType: "CarOwner",
        entityId: updated.id,
      });

      return updated;
    });

    res.json({ success: true, data: owner });
  }),
);
