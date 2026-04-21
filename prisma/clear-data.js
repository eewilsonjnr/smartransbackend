/**
 * SmarTrans Connect — Clear all data, preserve only super admin accounts.
 *
 * Deletion order respects FK constraints (children before parents):
 *   Alert → Violation → TripLocation → Trip
 *   → RouteTemplate
 *   → DriverVehicleAssignment → Vehicle
 *   → Driver → CarOwner → OrganizationUser → Organization
 *   → AuthorityUser → Authority
 *   → AuditLog → RefreshToken → LoginAttempt → non-super-admin User
 *
 * Only users with role SUPER_ADMIN are preserved.
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Clearing SmarTrans data (preserving only SUPER_ADMIN accounts)...\n");

  const superAdmins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { email: true, fullName: true },
  });

  if (superAdmins.length === 0) {
    throw new Error("No SUPER_ADMIN account found. Aborting cleanup.");
  }

  const deleted = await prisma.$transaction([
    prisma.alert.deleteMany(),
    prisma.violation.deleteMany(),
    prisma.tripLocation.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.routeTemplate.deleteMany(),
    prisma.driverVehicleAssignment.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.driver.deleteMany(),
    prisma.carOwner.deleteMany(),
    prisma.organizationUser.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.authorityUser.deleteMany(),
    prisma.authority.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.user.deleteMany({
      where: { role: { not: "SUPER_ADMIN" } },
    }),
  ]);

  const tables = [
    "Alert", "Violation", "TripLocation", "Trip", "RouteTemplate",
    "DriverVehicleAssignment", "Vehicle", "Driver", "CarOwner",
    "OrganizationUser", "Organization", "AuthorityUser", "Authority",
    "AuditLog", "RefreshToken", "LoginAttempt", "User(non-super-admin)",
  ];

  tables.forEach((t, i) => {
    console.log(`  ${t}: ${deleted[i].count} rows deleted`);
  });

  const preserved = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { email: true, fullName: true, role: true },
  });

  console.log(`\nDone. ${preserved.length} SUPER_ADMIN account(s) preserved:`);
  preserved.forEach((user) => {
    console.log(`  ${user.fullName} <${user.email ?? "no email"}>`);
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
