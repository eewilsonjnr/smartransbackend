import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../common/app-error";
import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { requireAuth, requireRoles } from "../../middleware/auth";
import { createAlert } from "../alerts/alert.service";
import { classifySpeedViolation } from "../violations/violation-engine";
import { assertOrganizationAccess, canReadSystem } from "../../utils/access";
import { writeAuditLog } from "../../utils/audit";
import { calculateRouteDistanceKm } from "../../utils/geo";

const coordinateSchema = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

const startTripSchema = z.object({
  driverId: z.string().min(1),
  vehicleId: z.string().min(1),
  routeTemplateId: z.string().min(1).optional(),
  startLatitude: coordinateSchema.latitude.optional(),
  startLongitude: coordinateSchema.longitude.optional(),
});

const addLocationSchema = z.object({
  latitude: coordinateSchema.latitude,
  longitude: coordinateSchema.longitude,
  speed: z.number().nonnegative().optional(),
  speedLimit: z.number().positive().optional(),
  recordedAt: z.coerce.date().optional(),
});

const batchLocationsSchema = z.object({
  points: z
    .array(
      z.object({
        latitude: coordinateSchema.latitude,
        longitude: coordinateSchema.longitude,
        speed: z.number().nonnegative().optional(),
        speedLimit: z.number().positive().optional(),
        recordedAt: z.coerce.date().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const endTripSchema = z.object({
  endLatitude: coordinateSchema.latitude.optional(),
  endLongitude: coordinateSchema.longitude.optional(),
});

const thirtyDaysAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date;
};

export const tripsRouter = Router();

tripsRouter.use(requireAuth);

tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = canReadSystem(req.auth!.role)
      ? undefined
      : req.auth!.role === "DRIVER"
        ? { driver: { userId: req.auth!.id } }
        : req.auth!.role === "CAR_OWNER"
          ? { carOwner: { userId: req.auth!.id } }
          : { organizationId: { in: req.auth!.organizationIds } };

    const trips = await prisma.trip.findMany({
      where,
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        organization: true,
        carOwner: { include: { user: true } },
        routeTemplate: true,
        _count: { select: { locations: true, violations: true, alerts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: trips });
  }),
);

tripsRouter.post(
  "/start",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "DRIVER"),
  validateBody(startTripSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof startTripSchema>;

    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: input.driverId },
      include: { user: true, organization: true },
    });

    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: { id: input.vehicleId },
      include: { carOwner: { include: { user: true } } },
    });

    if (req.auth!.role === "DRIVER" && driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only start trips for themselves.");
    }

    if (!driver.consentGiven) {
      throw new AppError(403, "Driver consent is required before tracking can begin.");
    }

    if (driver.organizationId !== vehicle.organizationId) {
      throw new AppError(400, "Driver and vehicle must belong to the same organization.");
    }

    assertOrganizationAccess(req.auth, driver.organizationId);

    const routeTemplate = input.routeTemplateId
      ? await prisma.routeTemplate.findUniqueOrThrow({ where: { id: input.routeTemplateId } })
      : null;

    if (routeTemplate) {
      if (routeTemplate.organizationId !== driver.organizationId) {
        throw new AppError(400, "Route template must belong to the driver's organization.");
      }

      if (routeTemplate.status !== "ACTIVE") {
        throw new AppError(400, "Route template must be active before it can be used for a trip.");
      }
    }

    const activeAssignment = await prisma.driverVehicleAssignment.findFirst({
      where: {
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        isActive: true,
      },
    });

    if (!activeAssignment) {
      throw new AppError(400, "Driver must be actively assigned to the vehicle before starting a trip.");
    }

    const existingTrip = await prisma.trip.findFirst({
      where: {
        driverId: input.driverId,
        status: "IN_PROGRESS",
      },
    });

    if (existingTrip) {
      throw new AppError(409, "Driver already has a trip in progress.");
    }

    const trip = await prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          driverId: driver.id,
          vehicleId: vehicle.id,
          organizationId: driver.organizationId,
          carOwnerId: vehicle.carOwnerId,
          routeTemplateId: routeTemplate?.id,
          startTime: new Date(),
          startLatitude: input.startLatitude,
          startLongitude: input.startLongitude,
        },
        include: {
          driver: { include: { user: true } },
          vehicle: true,
          carOwner: { include: { user: true } },
          routeTemplate: true,
        },
      });

      await createAlert(tx, {
        recipientUserId: vehicle.carOwner.userId,
        recipientRole: "CAR_OWNER",
        alertType: "TRIP_STARTED",
        message: `${driver.user.fullName} started ${routeTemplate ? `${routeTemplate.name} ` : "a trip "}with vehicle ${vehicle.registrationNumber}.`,
        tripId: created.id,
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "TRIP_STARTED",
        entityType: "Trip",
        entityId: created.id,
        details: {
          routeTemplateId: routeTemplate?.id,
        },
      });

      return created;
    });

    res.status(201).json({
      success: true,
      data: trip,
      speedLimit: routeTemplate?.speedLimit ?? driver.organization.speedLimit ?? env.DEFAULT_SPEED_LIMIT,
    });
  }),
);

tripsRouter.post(
  "/:id/locations",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "DRIVER"),
  validateBody(addLocationSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof addLocationSchema>;
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        carOwner: { include: { user: true } },
        routeTemplate: true,
      },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Cannot add locations to a trip that is not in progress.");
    }

    if (req.auth!.role === "DRIVER" && trip.driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only update their own trips.");
    }

    assertOrganizationAccess(req.auth, trip.organizationId);

    const speedLimit = input.speedLimit ?? trip.routeTemplate?.speedLimit ?? env.DEFAULT_SPEED_LIMIT;

    const result = await prisma.$transaction(async (tx) => {
      const location = await tx.tripLocation.create({
        data: {
          tripId: trip.id,
          latitude: input.latitude,
          longitude: input.longitude,
          speed: input.speed,
          recordedAt: input.recordedAt,
        },
      });

      let violation = null;

      if (typeof input.speed === "number" && input.speed > speedLimit) {
        const recentViolationCount = await tx.violation.count({
          where: {
            driverId: trip.driverId,
            violationTime: { gte: thirtyDaysAgo() },
          },
        });

        const classification = classifySpeedViolation(input.speed, speedLimit, recentViolationCount);

        violation = await tx.violation.create({
          data: {
            tripId: trip.id,
            driverId: trip.driverId,
            vehicleId: trip.vehicleId,
            organizationId: trip.organizationId,
            carOwnerId: trip.carOwnerId,
            violationType: classification.violationType,
            speed: input.speed,
            speedLimit,
            latitude: input.latitude,
            longitude: input.longitude,
            severity: classification.severity,
            violationTime: input.recordedAt,
          },
        });

        const message = `${trip.driver.user.fullName} exceeded ${speedLimit} km/h at ${input.speed} km/h.`;

        await createAlert(tx, {
          recipientUserId: trip.driver.userId,
          recipientRole: "DRIVER",
          alertType:
            classification.violationType === "SEVERE_OVER_SPEEDING"
              ? "SEVERE_VIOLATION"
              : classification.violationType === "REPEATED_OVER_SPEEDING"
                ? "REPEATED_VIOLATION"
                : "SPEED_VIOLATION",
          message,
          tripId: trip.id,
          violationId: violation.id,
        });

        await createAlert(tx, {
          recipientUserId: trip.carOwner.userId,
          recipientRole: "CAR_OWNER",
          alertType:
            classification.violationType === "SEVERE_OVER_SPEEDING"
              ? "SEVERE_VIOLATION"
              : classification.violationType === "REPEATED_OVER_SPEEDING"
                ? "REPEATED_VIOLATION"
                : "SPEED_VIOLATION",
          message,
          tripId: trip.id,
          violationId: violation.id,
        });
      }

      return { location, violation };
    });

    res.status(201).json({ success: true, data: result });
  }),
);

// Batch offline-sync endpoint — accepts up to 500 queued points at once
tripsRouter.post(
  "/:id/locations/batch",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "DRIVER"),
  validateBody(batchLocationsSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof batchLocationsSchema>;
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        carOwner: { include: { user: true } },
        routeTemplate: true,
      },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Cannot add locations to a trip that is not in progress.");
    }

    if (req.auth!.role === "DRIVER" && trip.driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only update their own trips.");
    }

    assertOrganizationAccess(req.auth, trip.organizationId);

    const results: { accepted: number; violations: number } = { accepted: 0, violations: 0 };

    for (const point of input.points) {
      const speedLimit = point.speedLimit ?? trip.routeTemplate?.speedLimit ?? env.DEFAULT_SPEED_LIMIT;

      await prisma.$transaction(async (tx) => {
        await tx.tripLocation.create({
          data: {
            tripId: trip.id,
            latitude: point.latitude,
            longitude: point.longitude,
            speed: point.speed,
            recordedAt: point.recordedAt,
          },
        });

        results.accepted += 1;

        if (typeof point.speed === "number" && point.speed > speedLimit) {
          const recentViolationCount = await tx.violation.count({
            where: {
              driverId: trip.driverId,
              violationTime: { gte: thirtyDaysAgo() },
            },
          });

          const classification = classifySpeedViolation(point.speed, speedLimit, recentViolationCount);

          const violation = await tx.violation.create({
            data: {
              tripId: trip.id,
              driverId: trip.driverId,
              vehicleId: trip.vehicleId,
              organizationId: trip.organizationId,
              carOwnerId: trip.carOwnerId,
              violationType: classification.violationType,
              speed: point.speed,
              speedLimit,
              latitude: point.latitude,
              longitude: point.longitude,
              severity: classification.severity,
              violationTime: point.recordedAt,
            },
          });

          const message = `${trip.driver.user.fullName} exceeded ${speedLimit} km/h at ${point.speed} km/h.`;
          const alertType =
            classification.violationType === "SEVERE_OVER_SPEEDING"
              ? "SEVERE_VIOLATION" as const
              : classification.violationType === "REPEATED_OVER_SPEEDING"
                ? "REPEATED_VIOLATION" as const
                : "SPEED_VIOLATION" as const;

          await Promise.all([
            createAlert(tx, {
              recipientUserId: trip.driver.userId,
              recipientRole: "DRIVER",
              alertType,
              message,
              tripId: trip.id,
              violationId: violation.id,
            }),
            createAlert(tx, {
              recipientUserId: trip.carOwner.userId,
              recipientRole: "CAR_OWNER",
              alertType,
              message,
              tripId: trip.id,
              violationId: violation.id,
            }),
          ]);

          results.violations += 1;
        }
      });
    }

    res.status(201).json({ success: true, data: results });
  }),
);

// Cancel an in-progress trip (admin/staff/org only)
tripsRouter.patch(
  "/:id/cancel",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  asyncHandler(async (req, res) => {
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { driver: { include: { user: true } } },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Only in-progress trips can be cancelled.");
    }

    assertOrganizationAccess(req.auth, trip.organizationId);

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.trip.update({
        where: { id: trip.id },
        data: { status: "CANCELLED", endTime: new Date() },
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "TRIP_CANCELLED",
        entityType: "Trip",
        entityId: trip.id,
      });

      return cancelled;
    });

    res.json({ success: true, data: updated });
  }),
);

// Driver-initiated distress alert — notifies org users and car owner
tripsRouter.post(
  "/:id/distress",
  requireRoles("DRIVER", "SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  asyncHandler(async (req, res) => {
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        carOwner: { include: { user: true } },
        organization: {
          include: {
            organizationUsers: { include: { user: true } },
          },
        },
      },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Trip is not in progress.");
    }

    if (req.auth!.role === "DRIVER" && trip.driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only send distress for their own trips.");
    }

    const message = `DISTRESS: ${trip.driver.user.fullName} has sent an emergency alert on vehicle ${trip.vehicle.registrationNumber}.`;

    const recipients: Array<{ id: string; role: "CAR_OWNER" | "ORG_ADMIN" | "ORG_OFFICER" | "STAFF" }> = [
      { id: trip.carOwner.userId, role: "CAR_OWNER" },
      ...trip.organization.organizationUsers.map((ou) => ({
        id: ou.userId,
        role: ou.role as "ORG_ADMIN" | "ORG_OFFICER",
      })),
    ];

    await Promise.all(
      recipients.map((r) =>
        createAlert(prisma, {
          recipientUserId: r.id,
          recipientRole: r.role,
          alertType: "DRIVER_DISTRESS",
          message,
          tripId: trip.id,
        }),
      ),
    );

    res.json({ success: true, message: "Distress alert sent." });
  }),
);

// System-reported idle alert — called by mobile when driver has not moved for threshold duration
tripsRouter.post(
  "/:id/idle-alert",
  requireRoles("DRIVER", "SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER"),
  asyncHandler(async (req, res) => {
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        carOwner: { include: { user: true } },
        organization: {
          include: {
            organizationUsers: { include: { user: true } },
          },
        },
      },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Trip is not in progress.");
    }

    if (req.auth!.role === "DRIVER" && trip.driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only report idle for their own trips.");
    }

    const message = `IDLE: ${trip.driver.user.fullName} on vehicle ${trip.vehicle.registrationNumber} has not moved for an extended period.`;

    const recipients: Array<{ id: string; role: "CAR_OWNER" | "ORG_ADMIN" | "ORG_OFFICER" | "STAFF" }> = [
      { id: trip.carOwner.userId, role: "CAR_OWNER" },
      ...trip.organization.organizationUsers.map((ou) => ({
        id: ou.userId,
        role: ou.role as "ORG_ADMIN" | "ORG_OFFICER",
      })),
    ];

    await Promise.all(
      recipients.map((r) =>
        createAlert(prisma, {
          recipientUserId: r.id,
          recipientRole: r.role,
          alertType: "DRIVER_IDLE",
          message,
          tripId: trip.id,
        }),
      ),
    );

    res.json({ success: true, message: "Idle alert sent." });
  }),
);

tripsRouter.patch(
  "/:id/end",
  requireRoles("SUPER_ADMIN", "STAFF", "ORG_ADMIN", "ORG_OFFICER", "DRIVER"),
  validateBody(endTripSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof endTripSchema>;
    const tripId = requiredParam(req, "id");

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        carOwner: { include: { user: true } },
        routeTemplate: true,
        locations: { orderBy: { recordedAt: "asc" } },
      },
    });

    if (trip.status !== "IN_PROGRESS") {
      throw new AppError(400, "Trip is not in progress.");
    }

    if (req.auth!.role === "DRIVER" && trip.driver.userId !== req.auth!.id) {
      throw new AppError(403, "Drivers can only end their own trips.");
    }

    assertOrganizationAccess(req.auth, trip.organizationId);

    const speeds = trip.locations
      .map((location) => location.speed)
      .filter((speed): speed is number => typeof speed === "number");

    const averageSpeed =
      speeds.length > 0 ? speeds.reduce((total, speed) => total + speed, 0) / speeds.length : null;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : null;
    const distance = calculateRouteDistanceKm(
      trip.locations.map((location) => ({
        latitude: location.latitude,
        longitude: location.longitude,
      })),
    );

    const updatedTrip = await prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({
        where: { id: trip.id },
        data: {
          endTime: new Date(),
          endLatitude: input.endLatitude,
          endLongitude: input.endLongitude,
          averageSpeed,
          maxSpeed,
          distance,
          status: "COMPLETED",
        },
        include: {
          driver: { include: { user: true } },
          vehicle: true,
          carOwner: { include: { user: true } },
          routeTemplate: true,
          _count: { select: { locations: true, violations: true, alerts: true } },
        },
      });

      await createAlert(tx, {
        recipientUserId: trip.carOwner.userId,
        recipientRole: "CAR_OWNER",
        alertType: "TRIP_ENDED",
        message: `${trip.driver.user.fullName} ended ${trip.routeTemplate ? `${trip.routeTemplate.name} ` : "a trip "}with vehicle ${trip.vehicle.registrationNumber}.`,
        tripId: trip.id,
      });

      await writeAuditLog(tx, {
        userId: req.auth?.id,
        action: "TRIP_ENDED",
        entityType: "Trip",
        entityId: trip.id,
      });

      return updated;
    });

    res.json({ success: true, data: updatedTrip });
  }),
);
