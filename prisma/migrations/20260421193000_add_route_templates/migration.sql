-- CreateEnum
CREATE TYPE "RouteTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "RouteTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION,
    "originLongitude" DOUBLE PRECISION,
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "estimatedDistanceKm" DOUBLE PRECISION,
    "estimatedDurationMinutes" INTEGER,
    "speedLimit" DOUBLE PRECISION,
    "status" "RouteTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteTemplate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "routeTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "RouteTemplate_organizationId_status_idx" ON "RouteTemplate"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RouteTemplate_organizationId_name_key" ON "RouteTemplate"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "RouteTemplate" ADD CONSTRAINT "RouteTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "RouteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
