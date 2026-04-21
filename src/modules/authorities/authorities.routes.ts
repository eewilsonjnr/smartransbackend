import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../common/app-error";
import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { assertAuthorityAccess, authorityScope, canManageSystem } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";
import { DEFAULT_AUTHORITY_PASSWORD, hashPassword } from "../../utils/auth";

const authorityTypeSchema = z.enum(["AUTHORITY", "REGULATOR"]);
const authorityStatusSchema = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]);
const authorityUserRoleSchema = z.enum(["ADMIN", "USER"]);
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
    message: "Authority admin requires an email or phone.",
    path: ["email"],
  });

const createAuthoritySchema = z.object({
  name: z.string().min(2),
  type: authorityTypeSchema,
  contactPerson: z.string().min(2).optional(),
  phone: z.string().min(6).optional(),
  email: z.string().email().optional(),
  address: z.string().min(2).optional(),
  status: authorityStatusSchema.default("ACTIVE"),
  admin: adminSchema.optional(),
});

const updateAuthoritySchema = z.object({
  name: z.string().min(2).optional(),
  type: authorityTypeSchema.optional(),
  contactPerson: z.string().min(2).optional(),
  phone: z.string().min(6).optional(),
  email: z.string().email().optional(),
  address: z.string().min(2).optional(),
  status: authorityStatusSchema.optional(),
});

const createAuthorityUserSchema = z
  .object({
    authorityId: z.string().min(1),
    fullName: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional(),
    password: optionalPasswordSchema,
    role: authorityUserRoleSchema.default("USER"),
  })
  .refine((value) => value.email || value.phone, {
    message: "Authority user requires an email or phone.",
    path: ["email"],
  });

const assertCanManageAuthorityUsers = (
  auth: Express.Request["auth"],
  authorityId: string,
) => {
  if (!auth) {
    throw new AppError(401, "Authentication is required.");
  }

  if (canManageSystem(auth.role)) {
    return;
  }

  if (auth.role === "AUTHORITY" && auth.authorityUserRole === "ADMIN") {
    assertAuthorityAccess(auth, authorityId);
    return;
  }

  throw new AppError(403, "Only authority admins can manage authority users.");
};

export const authoritiesRouter = Router();

authoritiesRouter.use(requireAuth);

authoritiesRouter.get(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "AUTHORITY"),
  asyncHandler(async (req, res) => {
    const authorities = await prisma.authority.findMany({
      where: authorityScope(req.auth),
      include: {
        _count: {
          select: { authorityUsers: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: authorities });
  }),
);

authoritiesRouter.get(
  "/users",
  requireRoles("SUPER_ADMIN", "STAFF", "AUTHORITY"),
  asyncHandler(async (req, res) => {
    const where = canManageSystem(req.auth!.role)
      ? undefined
      : { authorityId: { in: req.auth!.authorityIds } };

    const users = await prisma.authorityUser.findMany({
      where,
      include: {
        authority: {
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

authoritiesRouter.post(
  "/users",
  requireRoles("SUPER_ADMIN", "STAFF", "AUTHORITY"),
  validateBody(createAuthorityUserSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createAuthorityUserSchema>;
    assertCanManageAuthorityUsers(req.auth, input.authorityId);

    const authority = await prisma.authority.findUnique({ where: { id: input.authorityId } });
    if (!authority) {
      throw new AppError(404, "Authority was not found.");
    }

    const authorityUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? DEFAULT_AUTHORITY_PASSWORD),
          role: "AUTHORITY",
        },
      });

      const membership = await tx.authorityUser.create({
        data: {
          authorityId: input.authorityId,
          userId: user.id,
          role: input.role,
        },
        include: {
          authority: {
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
        action: "AUTHORITY_USER_CREATED",
        entityType: "AuthorityUser",
        entityId: membership.id,
        details: {
          authorityId: input.authorityId,
          role: input.role,
          userId: user.id,
        },
      });

      return membership;
    });

    res.status(201).json({ success: true, data: authorityUser });
  }),
);

authoritiesRouter.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF", "AUTHORITY"),
  asyncHandler(async (req, res) => {
    const authorityId = requiredParam(req, "id");
    assertAuthorityAccess(req.auth, authorityId);

    const authority = await prisma.authority.findUniqueOrThrow({
      where: { id: authorityId },
      include: {
        authorityUsers: {
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
          select: { authorityUsers: true },
        },
      },
    });

    res.json({ success: true, data: authority });
  }),
);

authoritiesRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF"),
  validateBody(createAuthoritySchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createAuthoritySchema>;

    const result = await prisma.$transaction(async (tx) => {
      const authority = await tx.authority.create({
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
            passwordHash: await hashPassword(input.admin.password ?? DEFAULT_AUTHORITY_PASSWORD),
            role: "AUTHORITY",
          },
        });

        adminUserId = adminUser.id;

        await tx.authorityUser.create({
          data: {
            authorityId: authority.id,
            userId: adminUser.id,
            role: "ADMIN",
          },
        });
      }

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "AUTHORITY_CREATED",
        entityType: "Authority",
        entityId: authority.id,
        details: { adminUserId: adminUserId ?? null, type: input.type },
      });

      return { authority, adminUserId };
    });

    res.status(201).json({ success: true, data: result });
  }),
);

authoritiesRouter.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF"),
  validateBody(updateAuthoritySchema),
  asyncHandler(async (req, res) => {
    const authorityId = requiredParam(req, "id");
    const input = req.body as z.infer<typeof updateAuthoritySchema>;

    const authority = await prisma.authority.update({
      where: { id: authorityId },
      data: {
        ...input,
        email: input.email?.toLowerCase(),
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "AUTHORITY_UPDATED",
      entityType: "Authority",
      entityId: authority.id,
    });

    res.json({ success: true, data: authority });
  }),
);
