import type { Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";

type AuditClient = Pick<typeof prisma, "auditLog"> | Prisma.TransactionClient;

export const writeAuditLog = (
  client: AuditClient,
  input: {
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Prisma.InputJsonValue;
  },
) =>
  client.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details,
    },
  });
