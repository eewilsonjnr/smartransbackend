import type { AlertType, DeliveryChannel, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { deliverAlert } from "./delivery";

type AlertClient = Pick<typeof prisma, "alert"> | Prisma.TransactionClient;

export const createAlert = async (
  client: AlertClient,
  input: {
    recipientUserId: string;
    recipientRole: UserRole;
    alertType: AlertType;
    message: string;
    deliveryChannel?: DeliveryChannel;
    tripId?: string;
    violationId?: string;
  },
) => {
  const alert = await client.alert.create({
    data: {
      recipientUserId: input.recipientUserId,
      recipientRole: input.recipientRole,
      alertType: input.alertType,
      message: input.message,
      deliveryChannel: input.deliveryChannel ?? "IN_APP",
      tripId: input.tripId,
      violationId: input.violationId,
    },
  });

  // Fire-and-forget delivery for external channels
  if (alert.deliveryChannel !== "IN_APP" && alert.deliveryChannel !== "DASHBOARD") {
    void dispatchDelivery(alert.id, input.recipientUserId, alert.deliveryChannel, input.message);
  }

  return alert;
};

async function dispatchDelivery(
  alertId: string,
  recipientUserId: string,
  channel: DeliveryChannel,
  message: string,
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: recipientUserId },
      select: { phone: true, email: true, pushToken: true },
    });

    const result = await deliverAlert({
      recipientUserId,
      channel,
      message,
      phone: user?.phone,
      email: user?.email,
      pushToken: user?.pushToken,
    });

    await prisma.alert.update({
      where: { id: alertId },
      data: {
        deliveryStatus: result.success ? "SENT" : "FAILED",
        sentAt: result.success ? new Date() : undefined,
      },
    });
  } catch {
    await prisma.alert
      .update({ where: { id: alertId }, data: { deliveryStatus: "FAILED" } })
      .catch(() => undefined);
  }
}
