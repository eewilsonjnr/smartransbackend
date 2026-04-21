import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { assertOrganizationAccess, canManageSystem, organizationScope } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";
import { DEFAULT_ORG_STAFF_PASSWORD, hashPassword } from "../../utils/auth";

const organizationTypeSchema = z.enum(["UNION", "STATION"]);
const organizationStatusSchema = z.enum(["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"]);
const optionalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(6, "Password must be at least 6 characters.").optional(),
);

const adminSchema = z
  .object({
    fullName: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional(),
    password: optionalPasswordSchema,
  })
  .refine((value) => value.email || value.phone, {
    message: "Organization admin requires an email or phone.",
    path: ["email"],
  });

const createOrganizationSchema = z.object({
  name: z.string().min(2),
  type: organizationTypeSchema,
  contactPerson: z.string().min(2).optional(),
  phone: z.string().min(6).optional(),
  email: z.string().email().optional(),
  address: z.string().min(2).optional(),
  status: organizationStatusSchema.default("ACTIVE"),
  admin: adminSchema.optional(),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  contactPerson: z.string().min(2).optional(),
  phone: z.string().min(6).optional(),
  email: z.string().email().optional(),
  address: z.string().min(2).optional(),
  status: organizationStatusSchema.optional(),
});

const createOrganizationUserSchema = z
  .object({
    organizationId: z.string().min(1),
    fullName: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional(),
    password: optionalPasswordSchema,
    role: z.enum(["ORG_ADMIN", "ORG_OFFICER"]).default("ORG_OFFICER"),
  })
  .refine((value) => value.email || value.phone, {
    message: "Organization user requires an email or phone.",
    path: ["email"],
  });

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizations = await prisma.organization.findMany({
      where: organizationScope(req.auth, { allowAuthority: true }),
      include: {
        _count: {
          select: {
            drivers: true,
            vehicles: true,
            trips: true,
            violations: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: organizations });
  }),
);

organizationsRouter.get(
  "/users",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN"),
  asyncHandler(async (req, res) => {
    const where = canManageSystem(req.auth!.role)
      ? undefined
      : { organizationId: { in: req.auth!.organizationIds } };

    const users = await prisma.organizationUser.findMany({
      where,
      include: {
        organization: {
          select: { id: true, name: true, type: true, status: true },
        },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: users });
  }),
);

organizationsRouter.post(
  "/users",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN"),
  validateBody(createOrganizationUserSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createOrganizationUserSchema>;
    assertOrganizationAccess(req.auth, input.organizationId);

    const organizationUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? DEFAULT_ORG_STAFF_PASSWORD),
          role: input.role,
        },
      });

      const membership = await tx.organizationUser.create({
        data: {
          organizationId: input.organizationId,
          userId: user.id,
          role: input.role,
        },
        include: {
          organization: {
            select: { id: true, name: true, type: true, status: true },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              role: true,
              status: true,
            },
          },
        },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "ORGANIZATION_USER_CREATED",
        entityType: "OrganizationUser",
        entityId: membership.id,
        details: {
          organizationId: input.organizationId,
          role: input.role,
          userId: user.id,
        },
      });

      return membership;
    });

    res.status(201).json({ success: true, data: organizationUser });
  }),
);

organizationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = requiredParam(req, "id");
    assertOrganizationAccess(req.auth, organizationId, { allowAuthority: true });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        organizationUsers: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            drivers: true,
            vehicles: true,
            trips: true,
            violations: true,
          },
        },
      },
    });

    res.json({ success: true, data: organization });
  }),
);

organizationsRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF"),
  validateBody(createOrganizationSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createOrganizationSchema>;

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          type: input.type,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email?.toLowerCase(),
          address: input.address,
          status: input.status,
          onboardedByStaffId: req.auth?.id,
        },
      });

      let adminUserId: string | undefined;

      if (input.admin) {
        const adminUser = await tx.user.create({
          data: {
            fullName: input.admin.fullName,
            email: input.admin.email?.toLowerCase(),
            phone: input.admin.phone,
            passwordHash: await hashPassword(input.admin.password ?? DEFAULT_ORG_STAFF_PASSWORD),
            role: "ORG_ADMIN",
          },
        });

        adminUserId = adminUser.id;

        await tx.organizationUser.create({
          data: {
            organizationId: organization.id,
            userId: adminUser.id,
            role: "ORG_ADMIN",
          },
        });
      }

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "ORGANIZATION_CREATED",
        entityType: "Organization",
        entityId: organization.id,
        details: { adminUserId: adminUserId ?? null },
      });

      return { organization, adminUserId };
    });

    res.status(201).json({ success: true, data: result });
  }),
);

organizationsRouter.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN"),
  validateBody(updateOrganizationSchema),
  asyncHandler(async (req, res) => {
    const organizationId = requiredParam(req, "id");
    assertOrganizationAccess(req.auth, organizationId);

    const input = req.body as z.infer<typeof updateOrganizationSchema>;
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...input,
        email: input.email?.toLowerCase(),
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "ORGANIZATION_UPDATED",
      entityType: "Organization",
      entityId: organization.id,
    });

    res.json({ success: true, data: organization });
  }),
);
