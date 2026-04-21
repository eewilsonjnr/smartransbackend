/**
 * SmarTrans Connect — Clear all transactional data, preserve user accounts.
 *
 * Deletion order respects FK constraints (children before parents):
 *   Alert → Violation → TripLocation → Trip
 *   → DriverVehicleAssignment → Vehicle
 *   → Driver → CarOwner → OrganizationUser → Organization
 *   → AuthorityUser → Authority
 *   → AuditLog → RefreshToken → LoginAttempt
 *
 * Users are NOT deleted.
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🗑️  Clearing SmarTrans data (preserving user accounts)…\n");

  const deleted = await prisma.$transaction([
    prisma.alert.deleteMany(),
    prisma.violation.deleteMany(),
    prisma.tripLocation.deleteMany(),
    prisma.trip.deleteMany(),
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
  ]);

  const tables = [
    "Alert", "Violation", "TripLocation", "Trip",
    "DriverVehicleAssignment", "Vehicle", "Driver", "CarOwner",
    "OrganizationUser", "Organization", "AuthorityUser", "Authority",
    "AuditLog", "RefreshToken", "LoginAttempt",
  ];

  tables.forEach((t, i) => {
    console.log(`  ✓ ${t}: ${deleted[i].count} rows deleted`);
  });

  const userCount = await prisma.user.count();
  console.log(`\n✅ Done. ${userCount} user accounts preserved.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
