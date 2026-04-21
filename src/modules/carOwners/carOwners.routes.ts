import type { Prisma } from "@prisma/client";
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
import { DEFAULT_CAR_OWNER_PASSWORD, hashPassword } from "../../utils/auth";

const optionalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(6, "Password must be at least 6 characters.").optional(),
);

const createCarOwnerSchema = z
  .object({
    organizationId: z.string().min(1).optional(),
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
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;
    const scopedOrganizationIds = organizationId ? [organizationId] : req.auth!.organizationIds;

    if (organizationId) {
      assertOrganizationAccess(req.auth, organizationId);
    }

    const ownerOrganizationMembershipWhere: Prisma.OrganizationUserWhereInput = {
      organizationId: { in: scopedOrganizationIds },
      role: "CAR_OWNER",
      status: "ACTIVE",
    };

    const where: Prisma.CarOwnerWhereInput | undefined =
      req.auth!.role === "CAR_OWNER"
        ? { userId: req.auth!.id }
        : canReadSystem(req.auth!.role) && !organizationId
          ? undefined
          : {
              OR: [
                {
                  user: {
                    is: {
                      organizationUsers: {
                        some: ownerOrganizationMembershipWhere,
                      },
                    },
                  },
                },
                {
                  vehicles: {
                    some: {
                      organizationId: { in: scopedOrganizationIds },
                    },
                  },
                },
              ],
            };

    const vehicleWhere: Prisma.VehicleWhereInput | undefined =
      req.auth!.role === "CAR_OWNER" || (canReadSystem(req.auth!.role) && !organizationId)
        ? undefined
        : { organizationId: { in: scopedOrganizationIds } };

    const organizationUserWhere: Prisma.OrganizationUserWhereInput =
      req.auth!.role === "CAR_OWNER" || (canReadSystem(req.auth!.role) && !organizationId)
        ? { role: "CAR_OWNER" as const, status: "ACTIVE" as const }
        : {
            organizationId: { in: scopedOrganizationIds },
            role: "CAR_OWNER" as const,
            status: "ACTIVE" as const,
          };

    const vehicleCountSelect = vehicleWhere ? { where: vehicleWhere } : true;

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
            organizationUsers: {
              where: organizationUserWhere,
              select: {
                organization: {
                  select: { id: true, name: true, type: true, status: true },
                },
              },
            },
          },
        },
        vehicles: {
          where: vehicleWhere,
          select: {
            id: true,
            organizationId: true,
            registrationNumber: true,
            organization: {
              select: { id: true, name: true, type: true, status: true },
            },
          },
        },
        _count: { select: { vehicles: vehicleCountSelect, trips: true, violations: true } },
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
    const organizationId =
      input.organizationId ??
      (!canReadSystem(req.auth!.role) && req.auth!.organizationIds.length === 1
        ? req.auth!.organizationIds[0]
        : undefined);

    if (!canReadSystem(req.auth!.role) && !organizationId) {
      throw new AppError(400, "Organization is required when creating a car owner from an organization account.");
    }

    if (organizationId) {
      assertOrganizationAccess(req.auth, organizationId);
    }

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

      if (organizationId) {
        await tx.organizationUser.create({
          data: {
            organizationId,
            userId: user.id,
            role: "CAR_OWNER",
          },
        });
      }

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
              organizationUsers: {
                where: organizationId
                  ? { organizationId, role: "CAR_OWNER", status: "ACTIVE" }
                  : { role: "CAR_OWNER", status: "ACTIVE" },
                select: {
                  organization: {
                    select: { id: true, name: true, type: true, status: true },
                  },
                },
              },
            },
          },
          vehicles: {
            select: {
              id: true,
              organizationId: true,
              registrationNumber: true,
              organization: {
                select: { id: true, name: true, type: true, status: true },
              },
            },
          },
          _count: { select: { vehicles: true, trips: true, violations: true } },
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
      include: {
        vehicles: true,
        user: {
          include: {
            organizationUsers: true,
          },
        },
      },
    });

    if (req.auth!.role === "CAR_OWNER") {
      if (existing.userId !== req.auth!.id) {
        throw new AppError(403, "Owners can only update their own profile.");
      }
    } else if (!canReadSystem(req.auth!.role)) {
      const hasOrganizationAccess =
        existing.vehicles.some((vehicle) => req.auth!.organizationIds.includes(vehicle.organizationId)) ||
        existing.user.organizationUsers.some((organizationUser) =>
          req.auth!.organizationIds.includes(organizationUser.organizationId),
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
