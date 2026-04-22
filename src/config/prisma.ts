import { PrismaClient } from "@prisma/client";

const prismaClientSingleton = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

declare global {
  // eslint-disable-next-line no-var
  var smartransPrisma: ReturnType<typeof prismaClientSingleton> | undefined;
}

export const prisma = globalThis.smartransPrisma ?? prismaClientSingleton();

globalThis.smartransPrisma = prisma;
