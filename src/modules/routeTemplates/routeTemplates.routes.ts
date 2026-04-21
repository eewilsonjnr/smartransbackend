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

const routeStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const routeTemplateFieldsSchema = z.object({
  name: z.string().min(2),
  origin: z.string().min(2),
  destination: z.string().min(2),
  originLatitude: z.number().min(-90).max(90).optional(),
  originLongitude: z.number().min(-180).max(180).optional(),
  destinationLatitude: z.number().min(-90).max(90).optional(),
  destinationLongitude: z.number().min(-180).max(180).optional(),
  estimatedDistanceKm: z.number().positive().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  speedLimit: z.number().positive().optional(),
});

const routeTemplateBodySchema = routeTemplateFieldsSchema.extend({
  organizationId: z.string().min(1),
  status: routeStatusSchema.default("ACTIVE"),
});

const updateRouteTemplateSchema = routeTemplateFieldsSchema.partial().extend({
  status: routeStatusSchema.optional(),
});

export const routeTemplatesRouter = Router();

routeTemplatesRouter.use(requireAuth);

routeTemplatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;
    const includeInactive = req.query.includeInactive === "true";

    if (organizationId) {
      assertOrganizationAccess(req.auth, organizationId);
    }

    const routeTemplates = await prisma.routeTemplate.findMany({
      where: {
        ...(organizationId
          ? { organizationId }
          : canReadSystem(req.auth!.role)
            ? {}
            : { organizationId: { in: req.auth!.organizationIds } }),
        ...(includeInactive ? {} : { status: "ACTIVE" }),
      },
      include: {
        organization: {
          select: { id: true, name: true, type: true, status: true, speedLimit: true },
        },
        _count: { select: { trips: true } },
      },
      orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
    });

    res.json({ success: true, data: routeTemplates });
  }),
);

routeTemplatesRouter.post(
  "/",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(routeTemplateBodySchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof routeTemplateBodySchema>;
    assertOrganizationAccess(req.auth, input.organizationId);

    const existing = await prisma.routeTemplate.findFirst({
      where: { organizationId: input.organizationId, name: input.name },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(409, "A route template with this name already exists for the organization.");
    }

    const routeTemplate = await prisma.routeTemplate.create({
      data: input,
      include: {
        organization: {
          select: { id: true, name: true, type: true, status: true, speedLimit: true },
        },
        _count: { select: { trips: true } },
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "ROUTE_TEMPLATE_CREATED",
      entityType: "RouteTemplate",
      entityId: routeTemplate.id,
      details: {
        organizationId: routeTemplate.organizationId,
        origin: routeTemplate.origin,
        destination: routeTemplate.destination,
      },
    });

    res.status(201).json({ success: true, data: routeTemplate });
  }),
);

routeTemplatesRouter.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  validateBody(updateRouteTemplateSchema),
  asyncHandler(async (req, res) => {
    const routeTemplateId = requiredParam(req, "id");
    const input = req.body as z.infer<typeof updateRouteTemplateSchema>;

    const existing = await prisma.routeTemplate.findUniqueOrThrow({
      where: { id: routeTemplateId },
    });
    assertOrganizationAccess(req.auth, existing.organizationId);

    if (input.name && input.name !== existing.name) {
      const duplicate = await prisma.routeTemplate.findFirst({
        where: {
          organizationId: existing.organizationId,
          name: input.name,
          id: { not: routeTemplateId },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new AppError(409, "A route template with this name already exists for the organization.");
      }
    }

    const routeTemplate = await prisma.routeTemplate.update({
      where: { id: routeTemplateId },
      data: input,
      include: {
        organization: {
          select: { id: true, name: true, type: true, status: true, speedLimit: true },
        },
        _count: { select: { trips: true } },
      },
    });

    await writeAuditLog(prisma, {
      userId: req.auth?.id,
      action: "ROUTE_TEMPLATE_UPDATED",
      entityType: "RouteTemplate",
      entityId: routeTemplate.id,
    });

    res.json({ success: true, data: routeTemplate });
  }),
);
