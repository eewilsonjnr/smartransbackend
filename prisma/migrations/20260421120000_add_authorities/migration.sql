-- CreateEnum
CREATE TYPE "AuthorityType" AS ENUM ('AUTHORITY', 'REGULATOR');

-- CreateEnum
CREATE TYPE "AuthorityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuthorityUserRole" AS ENUM ('ADMIN', 'USER');

-- CreateTable
CREATE TABLE "Authority" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AuthorityType" NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" "AuthorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "onboardedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Authority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityUser" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AuthorityUserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorityUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Authority_type_status_idx" ON "Authority"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityUser_authorityId_userId_key" ON "AuthorityUser"("authorityId", "userId");

-- CreateIndex
CREATE INDEX "AuthorityUser_authorityId_role_idx" ON "AuthorityUser"("authorityId", "role");

-- CreateIndex
CREATE INDEX "AuthorityUser_userId_idx" ON "AuthorityUser"("userId");

-- AddForeignKey
ALTER TABLE "Authority" ADD CONSTRAINT "Authority_onboardedByStaffId_fkey" FOREIGN KEY ("onboardedByStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityUser" ADD CONSTRAINT "AuthorityUser_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityUser" ADD CONSTRAINT "AuthorityUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
