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
import { DEFAULT_DRIVER_PASSWORD, hashPassword } from "../../utils/auth";

const optionalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(6, "Password must be at least 6 characters.").optional(),
);

const createDriverSchema = z
  .object({
    organizationId: z.string().min(1),
    fullName: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional(),
    password: optionalPasswordSchema,
    licenseNumber: z.string().min(3),
    nationalId: z.string().min(3).optional(),
    consentGiven: z.boolean().default(false),
  })
  .refine((value) => value.email || value.phone, {
    message: "Driver requires an email or phone.",
    path: ["email"],
  });

const updateDriverSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  nationalId: z.string().min(3).optional(),
  consentGiven: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

export const driversRouter = Router();

driversRouter.use(requireAuth);

driversRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = canReadSystem(req.auth!.role)
      ? undefined
      : req.auth!.role === "DRIVER"
        ? { userId: req.auth!.id }
        : { organizationId: { in: req.auth!.organizationIds } };

    const drivers = await prisma.driver.findMany({
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
        organization: true,
        assignments: {
          where: { isActive: true },
          include: { vehicle: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: drivers });
  }),
);

driversRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(createDriverSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createDriverSchema>;
    assertOrganizationAccess(req.auth, input.organizationId);

    const driver = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? DEFAULT_DRIVER_PASSWORD),
          role: "DRIVER",
        },
      });

      await tx.organizationUser.create({
        data: {
          organizationId: input.organizationId,
          userId: user.id,
          role: "DRIVER",
        },
      });

      const createdDriver = await tx.driver.create({
        data: {
          userId: user.id,
          organizationId: input.organizationId,
          licenseNumber: input.licenseNumber,
          nationalId: input.nationalId,
          consentGiven: input.consentGiven,
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
          organization: true,
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "DRIVER_CREATED",
        entityType: "Driver",
        entityId: createdDriver.id,
      });

      return createdDriver;
    });

    res.status(201).json({ success: true, data: driver });
  }),
);

driversRouter.patch(
  "/:id",
  validateBody(updateDriverSchema),
  asyncHandler(async (req, res) => {
    const driverId = requiredParam(req, "id");
    const input = req.body as z.infer<typeof updateDriverSchema>;

    const existing = await prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: { user: true },
    });

    if (req.auth!.role === "DRIVER") {
      if (existing.userId !== req.auth!.id) {
        throw new AppError(403, "Drivers can only update their own profile.");
      }

      const disallowedSelfFields = input.fullName || input.email || input.phone || input.nationalId || input.status;
      if (disallowedSelfFields) {
        throw new AppError(403, "Drivers can only update tracking consent from the mobile app.");
      }
    } else {
      assertOrganizationAccess(req.auth, existing.organizationId);
      if (!["SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"].includes(req.auth!.role)) {
        throw new AppError(403, "You do not have permission to update drivers.");
      }
    }

    const driver = await prisma.$transaction(async (tx) => {
      if (input.fullName || input.email || input.phone) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            fullName: input.fullName,
            email: input.email?.toLowerCase(),
            phone: input.phone,
            status: input.status,
          },
        });
      } else if (input.status) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { status: input.status },
        });
      }

      const updated = await tx.driver.update({
        where: { id: driverId },
        data: {
          nationalId: input.nationalId,
          consentGiven: input.consentGiven,
          status: input.status,
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
          organization: true,
          assignments: {
            where: { isActive: true },
            include: { vehicle: true },
          },
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "DRIVER_UPDATED",
        entityType: "Driver",
        entityId: updated.id,
      });

      return updated;
    });

    res.json({ success: true, data: driver });
  }),
);
