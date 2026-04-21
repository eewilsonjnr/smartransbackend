import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/async-handler";
import { requiredParam } from "../../common/params";
import { validateBody } from "../../common/validate";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";

const updateDeliveryStatusSchema = z.object({
  deliveryStatus: z.enum(["PENDING", "SENT", "FAILED"]),
});

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unread === "true";
    const alerts = await prisma.alert.findMany({
      where: {
        recipientUserId: req.auth!.id,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      include: {
        trip: true,
        violation: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const unreadCount = alerts.filter((a) => !a.isRead).length;
    res.json({ success: true, data: alerts, unreadCount });
  }),
);

// Mark a single alert as read
alertsRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const alertId = requiredParam(req, "id");

    await prisma.alert.findFirstOrThrow({
      where: { id: alertId, recipientUserId: req.auth!.id },
    });

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ success: true, data: alert });
  }),
);

// Mark all alerts as read for the current user
alertsRouter.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    const { count } = await prisma.alert.updateMany({
      where: { recipientUserId: req.auth!.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ success: true, updatedCount: count });
  }),
);

alertsRouter.patch(
  "/:id/delivery-status",
  validateBody(updateDeliveryStatusSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateDeliveryStatusSchema>;
    const alertId = requiredParam(req, "id");

    await prisma.alert.findFirstOrThrow({
      where: { id: alertId, recipientUserId: req.auth!.id },
    });

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        deliveryStatus: input.deliveryStatus,
        sentAt: input.deliveryStatus === "SENT" ? new Date() : undefined,
      },
    });

    res.json({ success: true, data: alert });
  }),
);
