/**
 * SmarTrans Connect — Comprehensive Database Seed
 *
 * Seeded accounts (password for all: SmarTrans@12345)
 * ─────────────────────────────────────────────────────
 * SUPER_ADMIN  : admin@smartrans.local
 * STAFF        : staff@smartrans.local
 * AUTHORITY    : authority@dvla.gov.gh, officer.adjei@dvla.gov.gh
 * ORG_ADMIN    : admin@metromass.gh, admin@stc.gh, admin@vvip.gh
 * CAR_OWNER    : owner1@smartrans.local … owner6@smartrans.local
 * DRIVER       : driver1@smartrans.local … driver12@smartrans.local
 */

const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const DEMO_PASSWORD = "SmarTrans@12345";

// ── helpers ──────────────────────────────────────────────────────────────────

async function hashPw() {
  return bcrypt.hash(DEMO_PASSWORD, 10);
}

async function upsertUser({ email, fullName, role, phone }) {
  const passwordHash = await hashPw();
  // Clear any other user that already holds this phone number
  if (phone) {
    await prisma.user.updateMany({
      where: { phone, NOT: { email } },
      data: { phone: null },
    });
  }
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, phone, status: "ACTIVE" },
    create: { fullName, email, phone, role, passwordHash },
  });
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3_600_000);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Ghana bounding box (approx): lat 4.7–11.2, lon -3.3–1.2
function randomGhanaCoord() {
  return {
    lat: randomBetween(4.9, 10.8),
    lon: randomBetween(-2.8, 0.8),
  };
}

async function upsertRouteTemplate({ key: _key, org, ...def }) {
  return prisma.routeTemplate.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: def.name,
      },
    },
    update: {
      origin: def.origin,
      destination: def.destination,
      originLatitude: def.originLatitude,
      originLongitude: def.originLongitude,
      destinationLatitude: def.destinationLatitude,
      destinationLongitude: def.destinationLongitude,
      estimatedDistanceKm: def.estimatedDistanceKm,
      estimatedDurationMinutes: def.estimatedDurationMinutes,
      speedLimit: def.speedLimit,
      status: "ACTIVE",
    },
    create: {
      organizationId: org.id,
      name: def.name,
      origin: def.origin,
      destination: def.destination,
      originLatitude: def.originLatitude,
      originLongitude: def.originLongitude,
      destinationLatitude: def.destinationLatitude,
      destinationLongitude: def.destinationLongitude,
      estimatedDistanceKm: def.estimatedDistanceKm,
      estimatedDurationMinutes: def.estimatedDurationMinutes,
      speedLimit: def.speedLimit,
      status: "ACTIVE",
    },
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding SmarTrans database…\n");

  const passwordHash = await hashPw();

  // ══════════════════════════════════════════════════════════════════════════
  // 1. SYSTEM USERS
  // ══════════════════════════════════════════════════════════════════════════

  const superAdmin = await upsertUser({
    email: "admin@smartrans.local",
    fullName: "System Administrator",
    phone: "+233200000000",
    role: "SUPER_ADMIN",
  });

  const staff = await upsertUser({
    email: "staff@smartrans.local",
    fullName: "Abena Owusu",
    phone: "+233200000001",
    role: "STAFF",
  });

  const staff2 = await upsertUser({
    email: "staff2@smartrans.local",
    fullName: "Emmanuel Tetteh",
    phone: "+233200000011",
    role: "STAFF",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. AUTHORITY USERS
  // ══════════════════════════════════════════════════════════════════════════

  const authority1 = await upsertUser({
    email: "authority@dvla.gov.gh",
    fullName: "DVLA Road Safety Unit",
    phone: "+233200000002",
    role: "AUTHORITY",
  });

  const authority2 = await upsertUser({
    email: "officer.adjei@dvla.gov.gh",
    fullName: "Officer Kofi Adjei",
    phone: "+233200000012",
    role: "AUTHORITY",
  });

  let dvlaAuthority = await prisma.authority.findFirst({
    where: { name: "Driver and Vehicle Licensing Authority" },
  });
  if (!dvlaAuthority) {
    dvlaAuthority = await prisma.authority.create({
      data: {
        name: "Driver and Vehicle Licensing Authority",
        type: "REGULATOR",
        contactPerson: "DVLA Road Safety Unit",
        phone: "+233302664691",
        email: "roadsafety@dvla.gov.gh",
        address: "1 Jawaharlal Nehru Road, Cantonments, Accra",
        status: "ACTIVE",
        onboardedByStaffId: staff.id,
      },
    });
  } else {
    dvlaAuthority = await prisma.authority.update({
      where: { id: dvlaAuthority.id },
      data: {
        type: "REGULATOR",
        contactPerson: "DVLA Road Safety Unit",
        phone: "+233302664691",
        email: "roadsafety@dvla.gov.gh",
        address: "1 Jawaharlal Nehru Road, Cantonments, Accra",
        status: "ACTIVE",
      },
    });
  }

  const authorityUserUpserts = [
    { authority: dvlaAuthority, user: authority1, role: "ADMIN" },
    { authority: dvlaAuthority, user: authority2, role: "USER" },
  ];
  for (const { authority, user, role } of authorityUserUpserts) {
    await prisma.authorityUser.upsert({
      where: { authorityId_userId: { authorityId: authority.id, userId: user.id } },
      update: { role, status: "ACTIVE" },
      create: { authorityId: authority.id, userId: user.id, role },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. ORGANISATIONS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Organisation 1: Metro Mass Transit ───────────────────────────────────
  const orgAdmin1 = await upsertUser({
    email: "admin@metromass.gh",
    fullName: "Kweku Mensah",
    phone: "+233200000003",
    role: "ORG_ADMIN",
  });

  const orgOfficer1 = await upsertUser({
    email: "officer@metromass.gh",
    fullName: "Adwoa Amponsah",
    phone: "+233200000013",
    role: "ORG_OFFICER",
  });

  let org1 = await prisma.organization.findFirst({ where: { name: "Metro Mass Transit" } });
  if (!org1) {
    org1 = await prisma.organization.create({
      data: {
        name: "Metro Mass Transit",
        type: "UNION",
        contactPerson: "Kweku Mensah",
        phone: "+233302123456",
        email: "info@metromass.gh",
        address: "Liberation Road, Accra",
        status: "ACTIVE",
        speedLimit: 70,
        onboardedByStaffId: staff.id,
      },
    });
  }

  // ── Organisation 2: Ghana STC ─────────────────────────────────────────────
  const orgAdmin2 = await upsertUser({
    email: "admin@stc.gh",
    fullName: "Yaa Boateng",
    phone: "+233200000004",
    role: "ORG_ADMIN",
  });

  let org2 = await prisma.organization.findFirst({ where: { name: "Ghana Intercity STC" } });
  if (!org2) {
    org2 = await prisma.organization.create({
      data: {
        name: "Ghana Intercity STC",
        type: "UNION",
        contactPerson: "Yaa Boateng",
        phone: "+233302654321",
        email: "info@stc.gh",
        address: "Ring Road, Accra",
        status: "ACTIVE",
        speedLimit: 80,
        onboardedByStaffId: staff.id,
      },
    });
  }

  // ── Organisation 3: VVIP Transport ───────────────────────────────────────
  const orgAdmin3 = await upsertUser({
    email: "admin@vvip.gh",
    fullName: "Nana Asante",
    phone: "+233200000005",
    role: "ORG_ADMIN",
  });

  let org3 = await prisma.organization.findFirst({ where: { name: "VVIP Transport" } });
  if (!org3) {
    org3 = await prisma.organization.create({
      data: {
        name: "VVIP Transport",
        type: "STATION",
        contactPerson: "Nana Asante",
        phone: "+233302789012",
        email: "info@vvip.gh",
        address: "Kumasi Road, Kumasi",
        status: "ACTIVE",
        speedLimit: 100,
        onboardedByStaffId: staff2.id,
      },
    });
  }

  // ── Organisation 4: Kaneshie Trotro Station (PENDING) ────────────────────
  let org4 = await prisma.organization.findFirst({ where: { name: "Kaneshie Trotro Station" } });
  if (!org4) {
    org4 = await prisma.organization.create({
      data: {
        name: "Kaneshie Trotro Station",
        type: "STATION",
        contactPerson: "Kwame Frimpong",
        phone: "+233244123789",
        email: "kaneshie@station.gh",
        address: "Kaneshie, Accra",
        status: "PENDING",
        speedLimit: 70,
        onboardedByStaffId: staff.id,
      },
    });
  }

  // OrganizationUser memberships
  const orgUserUpserts = [
    { org: org1, user: orgAdmin1, role: "ORG_ADMIN" },
    { org: org1, user: orgOfficer1, role: "ORG_OFFICER" },
    { org: org2, user: orgAdmin2, role: "ORG_ADMIN" },
    { org: org3, user: orgAdmin3, role: "ORG_ADMIN" },
  ];
  for (const { org, user, role } of orgUserUpserts) {
    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role, status: "ACTIVE" },
      create: { organizationId: org.id, userId: user.id, role },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. ROUTE TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════

  const routeTemplateDefs = [
    {
      key: "metroAccraKumasi", org: org1, name: "Accra to Kumasi",
      origin: "Accra", destination: "Kumasi",
      originLatitude: 5.6037, originLongitude: -0.1870, destinationLatitude: 6.6885, destinationLongitude: -1.6244,
      estimatedDistanceKm: 248, estimatedDurationMinutes: 270, speedLimit: 70,
    },
    {
      key: "metroKumasiAccra", org: org1, name: "Kumasi to Accra",
      origin: "Kumasi", destination: "Accra",
      originLatitude: 6.6885, originLongitude: -1.6244, destinationLatitude: 5.6037, destinationLongitude: -0.1870,
      estimatedDistanceKm: 248, estimatedDurationMinutes: 270, speedLimit: 70,
    },
    {
      key: "metroAccraTakoradi", org: org1, name: "Accra to Takoradi",
      origin: "Accra", destination: "Takoradi",
      originLatitude: 5.6037, originLongitude: -0.1870, destinationLatitude: 4.8845, destinationLongitude: -1.7554,
      estimatedDistanceKm: 220, estimatedDurationMinutes: 240, speedLimit: 70,
    },
    {
      key: "metroTakoradiAccra", org: org1, name: "Takoradi to Accra",
      origin: "Takoradi", destination: "Accra",
      originLatitude: 4.8845, originLongitude: -1.7554, destinationLatitude: 5.6037, destinationLongitude: -0.1870,
      estimatedDistanceKm: 220, estimatedDurationMinutes: 240, speedLimit: 70,
    },
    {
      key: "metroAccraTema", org: org1, name: "Accra Urban Shuttle",
      origin: "Accra", destination: "Tema",
      originLatitude: 5.5560, originLongitude: -0.1970, destinationLatitude: 5.6698, destinationLongitude: -0.0166,
      estimatedDistanceKm: 30, estimatedDurationMinutes: 60, speedLimit: 60,
    },
    {
      key: "metroAccraNsawam", org: org1, name: "Accra to Nsawam",
      origin: "Accra", destination: "Nsawam",
      originLatitude: 5.5550, originLongitude: -0.2020, destinationLatitude: 5.8080, destinationLongitude: -0.3510,
      estimatedDistanceKm: 38, estimatedDurationMinutes: 75, speedLimit: 70,
    },
    {
      key: "stcAccraKumasi", org: org2, name: "Accra to Kumasi",
      origin: "Accra", destination: "Kumasi",
      originLatitude: 5.6000, originLongitude: -0.1850, destinationLatitude: 6.6885, destinationLongitude: -1.6244,
      estimatedDistanceKm: 267, estimatedDurationMinutes: 300, speedLimit: 80,
    },
    {
      key: "stcKumasiAccra", org: org2, name: "Kumasi to Accra",
      origin: "Kumasi", destination: "Accra",
      originLatitude: 6.6885, originLongitude: -1.6244, destinationLatitude: 5.6000, destinationLongitude: -0.1850,
      estimatedDistanceKm: 267, estimatedDurationMinutes: 300, speedLimit: 80,
    },
    {
      key: "stcAccraTakoradi", org: org2, name: "Accra to Takoradi",
      origin: "Accra", destination: "Takoradi",
      originLatitude: 5.6000, originLongitude: -0.1850, destinationLatitude: 4.8845, destinationLongitude: -1.7554,
      estimatedDistanceKm: 220, estimatedDurationMinutes: 240, speedLimit: 80,
    },
    {
      key: "stcTakoradiAccra", org: org2, name: "Takoradi to Accra",
      origin: "Takoradi", destination: "Accra",
      originLatitude: 4.8845, originLongitude: -1.7554, destinationLatitude: 5.6000, destinationLongitude: -0.1850,
      estimatedDistanceKm: 220, estimatedDurationMinutes: 240, speedLimit: 80,
    },
    {
      key: "stcAccraNkawkaw", org: org2, name: "Accra to Nkawkaw",
      origin: "Accra", destination: "Nkawkaw",
      originLatitude: 5.5980, originLongitude: -0.1880, destinationLatitude: 6.5510, destinationLongitude: -0.7660,
      estimatedDistanceKm: 158, estimatedDurationMinutes: 210, speedLimit: 80,
    },
    {
      key: "vvipKumasiAccra", org: org3, name: "Kumasi to Accra",
      origin: "Kumasi", destination: "Accra",
      originLatitude: 6.6885, originLongitude: -1.6244, destinationLatitude: 5.6037, destinationLongitude: -0.1870,
      estimatedDistanceKm: 267, estimatedDurationMinutes: 300, speedLimit: 100,
    },
    {
      key: "vvipAccraKumasi", org: org3, name: "Accra to Kumasi",
      origin: "Accra", destination: "Kumasi",
      originLatitude: 5.6037, originLongitude: -0.1870, destinationLatitude: 6.6885, destinationLongitude: -1.6244,
      estimatedDistanceKm: 267, estimatedDurationMinutes: 300, speedLimit: 100,
    },
    {
      key: "vvipKumasiTamale", org: org3, name: "Kumasi to Tamale",
      origin: "Kumasi", destination: "Tamale",
      originLatitude: 6.6885, originLongitude: -1.6244, destinationLatitude: 9.4075, destinationLongitude: -0.8533,
      estimatedDistanceKm: 385, estimatedDurationMinutes: 360, speedLimit: 100,
    },
    {
      key: "vvipTamaleKumasi", org: org3, name: "Tamale to Kumasi",
      origin: "Tamale", destination: "Kumasi",
      originLatitude: 9.4075, originLongitude: -0.8533, destinationLatitude: 6.6885, destinationLongitude: -1.6244,
      estimatedDistanceKm: 385, estimatedDurationMinutes: 360, speedLimit: 100,
    },
  ];

  const routeTemplates = {};
  for (const def of routeTemplateDefs) {
    routeTemplates[def.key] = await upsertRouteTemplate(def);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. CAR OWNERS
  // ══════════════════════════════════════════════════════════════════════════

  const ownerDefs = [
    { email: "owner1@smartrans.local", fullName: "Akosua Frimpong",   phone: "+233244100001", address: "Tema, Greater Accra" },
    { email: "owner2@smartrans.local", fullName: "Yaw Darko",         phone: "+233244100002", address: "Kumasi, Ashanti" },
    { email: "owner3@smartrans.local", fullName: "Ama Serwaa",        phone: "+233244100003", address: "Takoradi, Western" },
    { email: "owner4@smartrans.local", fullName: "Kofi Acheampong",   phone: "+233244100004", address: "Accra Central" },
    { email: "owner5@smartrans.local", fullName: "Adjoa Mensah",      phone: "+233244100005", address: "Sunyani, Brong-Ahafo" },
    { email: "owner6@smartrans.local", fullName: "Kwabena Asante",    phone: "+233244100006", address: "Tamale, Northern" },
  ];

  const ownerUsers = [];
  const carOwners = [];
  for (const def of ownerDefs) {
    const u = await upsertUser({ ...def, role: "CAR_OWNER" });
    ownerUsers.push(u);
    const co = await prisma.carOwner.upsert({
      where: { userId: u.id },
      update: { address: def.address },
      create: { userId: u.id, address: def.address },
    });
    carOwners.push(co);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. DRIVERS
  // ══════════════════════════════════════════════════════════════════════════

  const driverDefs = [
    // Metro Mass (org1) — 5 drivers
    { email: "driver1@smartrans.local",  fullName: "Kofi Asante",       phone: "+233244200001", licence: "GH-DL-2019-004821", national: "GHA-001-0001", org: org1, consent: true  },
    { email: "driver2@smartrans.local",  fullName: "Abena Frimpong",    phone: "+233244200002", licence: "GH-DL-2018-002345", national: "GHA-001-0002", org: org1, consent: true  },
    { email: "driver3@smartrans.local",  fullName: "Emmanuel Osei",     phone: "+233244200003", licence: "GH-DL-2020-007812", national: "GHA-001-0003", org: org1, consent: false },
    { email: "driver4@smartrans.local",  fullName: "Gifty Amoah",       phone: "+233244200004", licence: "GH-DL-2021-009934", national: "GHA-001-0004", org: org1, consent: true  },
    { email: "driver5@smartrans.local",  fullName: "Richard Quaye",     phone: "+233244200005", licence: "GH-DL-2017-001102", national: "GHA-001-0005", org: org1, consent: true  },
    // Ghana STC (org2) — 4 drivers
    { email: "driver6@smartrans.local",  fullName: "Kwame Boateng",     phone: "+233244200006", licence: "GH-DL-2016-000443", national: "GHA-002-0001", org: org2, consent: true  },
    { email: "driver7@smartrans.local",  fullName: "Yaa Asantewaa",     phone: "+233244200007", licence: "GH-DL-2022-011567", national: "GHA-002-0002", org: org2, consent: true  },
    { email: "driver8@smartrans.local",  fullName: "Isaac Appiah",      phone: "+233244200008", licence: "GH-DL-2020-008812", national: "GHA-002-0003", org: org2, consent: true  },
    { email: "driver9@smartrans.local",  fullName: "Beatrice Nyarko",   phone: "+233244200009", licence: "GH-DL-2019-005671", national: "GHA-002-0004", org: org2, consent: false },
    // VVIP (org3) — 3 drivers
    { email: "driver10@smartrans.local", fullName: "Nana Kwasi Poku",   phone: "+233244200010", licence: "GH-DL-2018-003344", national: "GHA-003-0001", org: org3, consent: true  },
    { email: "driver11@smartrans.local", fullName: "Akua Gyamfi",       phone: "+233244200011", licence: "GH-DL-2021-010011", national: "GHA-003-0002", org: org3, consent: true  },
    { email: "driver12@smartrans.local", fullName: "Daniel Asiedu",     phone: "+233244200012", licence: "GH-DL-2023-014578", national: "GHA-003-0003", org: org3, consent: true  },
  ];

  const driverUsers = [];
  const drivers = [];
  for (const def of driverDefs) {
    const u = await upsertUser({ email: def.email, fullName: def.fullName, phone: def.phone, role: "DRIVER" });
    driverUsers.push(u);

    const dr = await prisma.driver.upsert({
      where: { userId: u.id },
      update: { organizationId: def.org.id, consentGiven: def.consent, status: "ACTIVE" },
      create: {
        userId: u.id,
        organizationId: def.org.id,
        licenseNumber: def.licence,
        nationalId: def.national,
        consentGiven: def.consent,
      },
    });
    drivers.push(dr);

    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: def.org.id, userId: u.id } },
      update: { role: "DRIVER", status: "ACTIVE" },
      create: { organizationId: def.org.id, userId: u.id, role: "DRIVER" },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. VEHICLES
  // ══════════════════════════════════════════════════════════════════════════

  const vehicleDefs = [
    // Metro Mass fleet
    { reg: "GH-1234-22", type: "Bus",    make: "Yutong",   model: "ZK6122H",    color: "Yellow/White", org: org1, owner: carOwners[0] },
    { reg: "GH-5678-21", type: "Bus",    make: "Higer",    model: "KLQ6129GQ",  color: "Yellow/Blue",  org: org1, owner: carOwners[0] },
    { reg: "GH-9012-23", type: "Trotro", make: "Toyota",   model: "Hiace",      color: "White",        org: org1, owner: carOwners[1] },
    { reg: "GH-3456-20", type: "Trotro", make: "Nissan",   model: "Urvan",      color: "Cream",        org: org1, owner: carOwners[1] },
    { reg: "GH-7890-22", type: "Bus",    make: "King Long", model: "XMQ6127J",  color: "White/Green",  org: org1, owner: carOwners[2] },
    // Ghana STC fleet
    { reg: "GH-1111-19", type: "Coach",  make: "Scania",   model: "K410 IB",   color: "White/Blue",   org: org2, owner: carOwners[2] },
    { reg: "GH-2222-20", type: "Coach",  make: "Volvo",    model: "B11R",       color: "White",        org: org2, owner: carOwners[3] },
    { reg: "GH-3333-21", type: "Coach",  make: "DAF",      model: "CF480",      color: "Silver",       org: org2, owner: carOwners[3] },
    { reg: "GH-4444-22", type: "Bus",    make: "Yutong",   model: "ZK6129H",    color: "White/Red",    org: org2, owner: carOwners[4] },
    // VVIP fleet
    { reg: "GH-5555-22", type: "Coach",  make: "Mercedes", model: "Tourismo",   color: "White/Gold",   org: org3, owner: carOwners[4] },
    { reg: "GH-6666-23", type: "Coach",  make: "Volvo",    model: "9700",       color: "Black/Gold",   org: org3, owner: carOwners[5] },
    { reg: "GH-7777-21", type: "Coach",  make: "Scania",   model: "Touring",    color: "White/Red",    org: org3, owner: carOwners[5] },
  ];

  const vehicles = [];
  for (const def of vehicleDefs) {
    const v = await prisma.vehicle.upsert({
      where: { registrationNumber: def.reg },
      update: { organizationId: def.org.id, carOwnerId: def.owner.id, status: "ACTIVE" },
      create: {
        organizationId: def.org.id,
        carOwnerId: def.owner.id,
        registrationNumber: def.reg,
        vehicleType: def.type,
        make: def.make,
        model: def.model,
        color: def.color,
      },
    });
    vehicles.push(v);

    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: def.org.id, userId: def.owner.userId } },
      update: { role: "CAR_OWNER", status: "ACTIVE" },
      create: { organizationId: def.org.id, userId: def.owner.userId, role: "CAR_OWNER" },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. DRIVER-VEHICLE ASSIGNMENTS
  // ══════════════════════════════════════════════════════════════════════════

  // Map: driver index → vehicle index
  const assignments = [
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4],   // Metro Mass
    [5, 5], [6, 6], [7, 7], [8, 8],             // STC
    [9, 9], [10, 10], [11, 11],                 // VVIP
  ];

  for (const [di, vi] of assignments) {
    const existing = await prisma.driverVehicleAssignment.findFirst({
      where: { driverId: drivers[di].id, vehicleId: vehicles[vi].id, isActive: true },
    });
    if (!existing) {
      await prisma.driverVehicleAssignment.create({
        data: { driverId: drivers[di].id, vehicleId: vehicles[vi].id },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. TRIPS (historical + in-progress)
  // ══════════════════════════════════════════════════════════════════════════

  const tripDefs = [
    // Recent completed trips
    { route: "metroAccraKumasi", di: 0, vi: 0, org: org1, owneri: 0, daysBack: 0,  duration: 4.5,  avg: 64, max: 78,  dist: 248, status: "COMPLETED",    lat1: 5.603,  lon1: -0.187, lat2: 6.688, lon2: -1.624 },
    { route: "metroAccraTema", di: 1, vi: 1, org: org1, owneri: 0, daysBack: 0,  duration: 2.2,  avg: 52, max: 71,  dist: 115, status: "COMPLETED",    lat1: 5.556,  lon1: -0.197, lat2: 5.751, lon2: -0.211 },
    { route: "stcAccraKumasi", di: 5, vi: 5, org: org2, owneri: 2, daysBack: 0,  duration: 5.1,  avg: 72, max: 142, dist: 267, status: "COMPLETED",    lat1: 5.600,  lon1: -0.185, lat2: 6.687, lon2: -1.625 },
    { route: "stcAccraNkawkaw", di: 6, vi: 6, org: org2, owneri: 3, daysBack: 0,  duration: 3.8,  avg: 68, max: 102, dist: 198, status: "COMPLETED",    lat1: 5.598,  lon1: -0.188, lat2: 6.412, lon2: -0.912 },
    { route: "vvipKumasiTamale", di: 9, vi: 9, org: org3, owneri: 4, daysBack: 0,  duration: 6.2,  avg: 88, max: 115, dist: 412, status: "COMPLETED",    lat1: 6.688,  lon1: -1.624, lat2: 9.401, lon2: -0.839 },
    // Yesterday
    { route: "metroAccraNsawam", di: 2, vi: 2, org: org1, owneri: 1, daysBack: 1,  duration: 3.0,  avg: 48, max: 65,  dist: 145, status: "COMPLETED",    lat1: 5.555,  lon1: -0.202, lat2: 5.900, lon2: -0.198 },
    { route: "stcAccraKumasi", di: 7, vi: 7, org: org2, owneri: 3, daysBack: 1,  duration: 4.4,  avg: 75, max: 108, dist: 298, status: "COMPLETED",    lat1: 5.601,  lon1: -0.186, lat2: 6.688, lon2: -1.623 },
    { route: "vvipKumasiTamale", di: 10, vi: 10, org: org3, owneri: 4, daysBack: 1, duration: 5.5, avg: 90, max: 120, dist: 385, status: "COMPLETED",   lat1: 6.687,  lon1: -1.622, lat2: 9.400, lon2: -0.838 },
    // 3 days ago
    { route: "metroAccraTema", di: 3, vi: 3, org: org1, owneri: 1, daysBack: 3,  duration: 2.7,  avg: 55, max: 80,  dist: 148, status: "COMPLETED",    lat1: 5.560,  lon1: -0.200, lat2: 5.752, lon2: -0.210 },
    { route: "stcAccraNkawkaw", di: 8, vi: 8, org: org2, owneri: 4, daysBack: 3,  duration: 3.2,  avg: 60, max: 88,  dist: 192, status: "COMPLETED",    lat1: 5.598,  lon1: -0.190, lat2: 6.100, lon2: -0.500 },
    { route: "vvipKumasiTamale", di: 11, vi: 11, org: org3, owneri: 5, daysBack: 3, duration: 5.8, avg: 92, max: 135, dist: 440, status: "COMPLETED",   lat1: 6.690,  lon1: -1.627, lat2: 9.402, lon2: -0.840 },
    // 7 days ago
    { route: "metroAccraKumasi", di: 4, vi: 4, org: org1, owneri: 2, daysBack: 7,  duration: 4.1,  avg: 66, max: 95,  dist: 270, status: "COMPLETED",    lat1: 5.600,  lon1: -0.186, lat2: 6.688, lon2: -1.624 },
    { route: "metroKumasiAccra", di: 0, vi: 0, org: org1, owneri: 0, daysBack: 7,  duration: 4.3,  avg: 63, max: 76,  dist: 244, status: "COMPLETED",    lat1: 6.688,  lon1: -1.624, lat2: 5.603, lon2: -0.187 },
    { route: "stcAccraKumasi", di: 5, vi: 5, org: org2, owneri: 2, daysBack: 7,  duration: 5.3,  avg: 74, max: 118, dist: 272, status: "COMPLETED",    lat1: 5.601,  lon1: -0.185, lat2: 6.689, lon2: -1.626 },
    // In-progress (active now)
    { route: "metroAccraTakoradi", di: 0, vi: 0, org: org1, owneri: 0, daysBack: -0.1, duration: null, avg: null, max: null, dist: null, status: "IN_PROGRESS", lat1: 5.603, lon1: -0.187, lat2: null, lon2: null },
    { route: "stcAccraTakoradi", di: 6, vi: 6, org: org2, owneri: 3, daysBack: -0.05, duration: null, avg: null, max: null, dist: null, status: "IN_PROGRESS", lat1: 5.598, lon1: -0.190, lat2: null, lon2: null },
  ];

  const trips = [];
  for (const def of tripDefs) {
    const startTime = daysAgo(def.daysBack);
    const endTime =
      def.status === "COMPLETED"
        ? new Date(startTime.getTime() + def.duration * 3_600_000)
        : null;

    const trip = await prisma.trip.create({
      data: {
        driverId: drivers[def.di].id,
        vehicleId: vehicles[def.vi].id,
        organizationId: def.org.id,
        carOwnerId: carOwners[def.owneri].id,
        routeTemplateId: routeTemplates[def.route]?.id,
        startTime,
        endTime,
        startLatitude: def.lat1,
        startLongitude: def.lon1,
        endLatitude: def.lat2 ?? null,
        endLongitude: def.lon2 ?? null,
        averageSpeed: def.avg,
        maxSpeed: def.max,
        distance: def.dist,
        status: def.status,
      },
    });
    trips.push(trip);

    // Add a handful of TripLocation points per completed trip
    if (def.status === "COMPLETED" && def.lat1 && def.lat2) {
      const pointCount = 6;
      for (let i = 0; i < pointCount; i++) {
        const frac = i / (pointCount - 1);
        await prisma.tripLocation.create({
          data: {
            tripId: trip.id,
            latitude:  def.lat1 + (def.lat2 - def.lat1) * frac,
            longitude: def.lon1 + ((def.lon2 ?? def.lon1) - def.lon1) * frac,
            speed: randomBetween(40, def.max),
            recordedAt: new Date(startTime.getTime() + (def.duration * 3_600_000 * frac)),
          },
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. VIOLATIONS
  // ══════════════════════════════════════════════════════════════════════════

  // trip index, speed, limit, severity, type, lat, lon, hoursBack
  const violationDefs = [
    // Critical — Kwame Boateng (driver5, trip2, STC)
    { ti: 2,  di: 5,  vi: 5,  org: org2, owneri: 2, speed: 142, limit: 70, sev: "CRITICAL", type: "SEVERE_OVER_SPEEDING",   lat: 5.850, lon: -0.280, hBack: 2  },
    // High — Yaa Asantewaa (driver6, trip3, STC)
    { ti: 3,  di: 6,  vi: 6,  org: org2, owneri: 3, speed: 102, limit: 80, sev: "HIGH",     type: "OVER_SPEEDING",           lat: 6.100, lon: -0.500, hBack: 5  },
    // High — Nana Kwasi Poku (driver9, trip4, VVIP)
    { ti: 4,  di: 9,  vi: 9,  org: org3, owneri: 4, speed: 115, limit: 100, sev: "MEDIUM",  type: "OVER_SPEEDING",           lat: 8.100, lon: -0.700, hBack: 8  },
    // Medium — Richard Quaye (driver4, trip11, Metro)
    { ti: 11, di: 4,  vi: 4,  org: org1, owneri: 2, speed: 95,  limit: 70, sev: "HIGH",     type: "OVER_SPEEDING",           lat: 6.200, lon: -1.000, hBack: 24 },
    // Critical repeated — Kwame Boateng again (trip13, STC)
    { ti: 13, di: 5,  vi: 5,  org: org2, owneri: 2, speed: 118, limit: 80, sev: "CRITICAL", type: "REPEATED_OVER_SPEEDING",  lat: 5.900, lon: -0.300, hBack: 170 },
    // High — Isaac Appiah (driver7, trip6, STC)
    { ti: 6,  di: 7,  vi: 7,  org: org2, owneri: 3, speed: 108, limit: 80, sev: "HIGH",     type: "OVER_SPEEDING",           lat: 6.300, lon: -1.100, hBack: 28 },
    // High — Akua Gyamfi (driver10, trip7, VVIP)
    { ti: 7,  di: 10, vi: 10, org: org3, owneri: 4, speed: 120, limit: 100, sev: "MEDIUM",  type: "OVER_SPEEDING",           lat: 8.200, lon: -0.600, hBack: 30 },
    // Critical — Daniel Asiedu (driver11, trip10, VVIP)
    { ti: 10, di: 11, vi: 11, org: org3, owneri: 5, speed: 135, limit: 100, sev: "CRITICAL", type: "SEVERE_OVER_SPEEDING",   lat: 8.500, lon: -0.500, hBack: 72 },
    // Low — Kofi Asante (driver0, trip12, Metro)
    { ti: 12, di: 0,  vi: 0,  org: org1, owneri: 0, speed: 88,  limit: 70, sev: "MEDIUM",   type: "OVER_SPEEDING",           lat: 6.100, lon: -1.300, hBack: 168 },
    // Low — Abena Frimpong (driver1, trip1, Metro)
    { ti: 1,  di: 1,  vi: 1,  org: org1, owneri: 0, speed: 71,  limit: 70, sev: "LOW",      type: "OVER_SPEEDING",           lat: 5.700, lon: -0.200, hBack: 6  },
  ];

  const violations = [];
  for (const def of violationDefs) {
    const tripRef = trips[def.ti];
    if (!tripRef) continue;
    const v = await prisma.violation.create({
      data: {
        tripId: tripRef.id,
        driverId: drivers[def.di].id,
        vehicleId: vehicles[def.vi].id,
        organizationId: def.org.id,
        carOwnerId: carOwners[def.owneri].id,
        violationType: def.type,
        speed: def.speed,
        speedLimit: def.limit,
        latitude: def.lat,
        longitude: def.lon,
        severity: def.sev,
        violationTime: hoursAgo(def.hBack),
        status: "OPEN",
      },
    });
    violations.push(v);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11. ALERTS
  // ══════════════════════════════════════════════════════════════════════════

  // Recipients to notify: driver of the violation, org admin, authority
  const alertDefs = [];

  for (let i = 0; i < violations.length; i++) {
    const viol = violations[i];
    const vDef = violationDefs[i];
    const driverUserId = driverUsers[vDef.di].id;
    const orgAdminUser = vDef.org.id === org1.id ? orgAdmin1
                       : vDef.org.id === org2.id ? orgAdmin2 : orgAdmin3;

    const msg = `Speed ${vDef.speed} km/h exceeded the ${vDef.limit} km/h limit — ${vDef.sev} violation.`;

    // In-app alert to driver
    alertDefs.push({
      violationId: viol.id, tripId: trips[vDef.ti].id,
      recipientUserId: driverUserId, recipientRole: "DRIVER",
      alertType: "SPEED_VIOLATION", message: msg,
      deliveryChannel: "IN_APP", deliveryStatus: "SENT",
      isRead: i > 3, sentAt: hoursAgo(vDef.hBack - 0.01),
    });

    // Push alert to driver
    alertDefs.push({
      violationId: viol.id, tripId: trips[vDef.ti].id,
      recipientUserId: driverUserId, recipientRole: "DRIVER",
      alertType: "SPEED_VIOLATION", message: msg,
      deliveryChannel: "PUSH", deliveryStatus: i < 4 ? "SENT" : "FAILED",
      isRead: i > 3, sentAt: hoursAgo(vDef.hBack - 0.01),
    });

    // SMS to org admin for CRITICAL and HIGH
    if (["CRITICAL", "HIGH"].includes(vDef.sev)) {
      alertDefs.push({
        violationId: viol.id, tripId: trips[vDef.ti].id,
        recipientUserId: orgAdminUser.id, recipientRole: "ORG_ADMIN",
        alertType: "SPEED_VIOLATION",
        message: `[SmarTrans] ${vDef.sev} speed alert: driver recorded ${vDef.speed} km/h. ${msg}`,
        deliveryChannel: "SMS", deliveryStatus: "SENT",
        isRead: i > 2, sentAt: hoursAgo(vDef.hBack - 0.02),
      });
    }

    // Dashboard alert for authority on CRITICAL
    if (vDef.sev === "CRITICAL") {
      alertDefs.push({
        violationId: viol.id, tripId: trips[vDef.ti].id,
        recipientUserId: authority1.id, recipientRole: "AUTHORITY",
        alertType: "SEVERE_VIOLATION",
        message: `CRITICAL: vehicle recorded ${vDef.speed} km/h vs ${vDef.limit} km/h limit.`,
        deliveryChannel: "DASHBOARD", deliveryStatus: "SENT",
        isRead: false, sentAt: hoursAgo(vDef.hBack - 0.03),
      });
    }
  }

  // Trip-started and trip-ended alerts for active trips
  for (const trip of trips.slice(0, 6)) {
    const driverIdx = tripDefs[trips.indexOf(trip)]?.di ?? 0;
    if (driverIdx === undefined) continue;
    alertDefs.push({
      tripId: trip.id, violationId: null,
      recipientUserId: driverUsers[driverIdx]?.id ?? driverUsers[0].id,
      recipientRole: "DRIVER",
      alertType: "TRIP_STARTED",
      message: "Your trip has started. GPS tracking is now active.",
      deliveryChannel: "IN_APP", deliveryStatus: "SENT",
      isRead: true, sentAt: new Date(trip.startTime.getTime() + 5000),
    });
  }

  for (const def of alertDefs) {
    await prisma.alert.create({ data: { ...def, readAt: def.isRead ? def.sentAt : null } });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 12. AUDIT LOGS
  // ══════════════════════════════════════════════════════════════════════════

  const auditEntries = [
    { userId: staff.id,    action: "ORG_CREATED",     entity: "Organization", entityId: org1.id,      details: { name: org1.name } },
    { userId: staff.id,    action: "ORG_CREATED",     entity: "Organization", entityId: org2.id,      details: { name: org2.name } },
    { userId: staff2.id,   action: "ORG_CREATED",     entity: "Organization", entityId: org3.id,      details: { name: org3.name } },
    { userId: orgAdmin1.id, action: "ROUTE_TEMPLATE_CREATED", entity: "RouteTemplate", entityId: routeTemplates.metroAccraKumasi.id, details: { name: "Accra to Kumasi" } },
    { userId: orgAdmin2.id, action: "ROUTE_TEMPLATE_CREATED", entity: "RouteTemplate", entityId: routeTemplates.stcAccraTakoradi.id, details: { name: "Accra to Takoradi" } },
    { userId: staff.id,    action: "DRIVER_ENROLLED",  entity: "Driver",       entityId: drivers[0].id, details: { licenseNumber: driverDefs[0].licence } },
    { userId: orgAdmin1.id, action: "VEHICLE_ADDED",  entity: "Vehicle",      entityId: vehicles[0].id, details: { reg: "GH-1234-22" } },
    { userId: orgAdmin2.id, action: "VEHICLE_ADDED",  entity: "Vehicle",      entityId: vehicles[5].id, details: { reg: "GH-1111-19" } },
    { userId: orgAdmin3.id, action: "SPEED_LIMIT_UPDATED", entity: "Organization", entityId: org3.id, details: { from: 80, to: 100 } },
    { userId: authority1.id, action: "COMPLIANCE_REPORT_EXPORTED", entity: "System", entityId: null, details: { format: "CSV", period: "30d" } },
    { userId: superAdmin.id, action: "DATABASE_SEEDED", entity: "System", entityId: null, details: { orgs: 4, drivers: 12, vehicles: 12 } },
  ];

  for (const entry of auditEntries) {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entity,
        entityId: entry.entityId,
        details: entry.details,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log("✅ Seed complete!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Password for ALL accounts: ${DEMO_PASSWORD}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n📋 System");
  console.log(`   SUPER_ADMIN  : admin@smartrans.local`);
  console.log(`   STAFF        : staff@smartrans.local, staff2@smartrans.local`);
  console.log("\n🚔 Authority");
  console.log(`   AUTHORITY    : authority@dvla.gov.gh`);
  console.log(`   AUTHORITY    : officer.adjei@dvla.gov.gh`);
  console.log("\n🏢 Organisation Admins");
  console.log(`   ORG_ADMIN    : admin@metromass.gh   (Metro Mass Transit)`);
  console.log(`   ORG_OFFICER  : officer@metromass.gh (Metro Mass Transit)`);
  console.log(`   ORG_ADMIN    : admin@stc.gh         (Ghana Intercity STC)`);
  console.log(`   ORG_ADMIN    : admin@vvip.gh        (VVIP Transport)`);
  console.log("\n🚗 Car Owners");
  for (let i = 0; i < ownerDefs.length; i++) {
    console.log(`   CAR_OWNER    : ${ownerDefs[i].email}`);
  }
  console.log("\n🚌 Drivers");
  for (let i = 0; i < driverDefs.length; i++) {
    const orgName = driverDefs[i].org.name.padEnd(22);
    console.log(`   DRIVER       : ${driverDefs[i].email.padEnd(32)} (${orgName})`);
  }
  console.log("\n📊 Database");
  console.log(`   Organisations : 4 (3 ACTIVE, 1 PENDING)`);
  console.log(`   Vehicles      : ${vehicleDefs.length}`);
  console.log(`   Drivers       : ${driverDefs.length}`);
  console.log(`   Route templates: ${routeTemplateDefs.length}`);
  console.log(`   Trips         : ${tripDefs.length} (${tripDefs.filter(t => t.status === "IN_PROGRESS").length} in-progress)`);
  console.log(`   Violations    : ${violationDefs.length}`);
  console.log(`   Alerts        : ${alertDefs.length}`);
  console.log(`   Audit logs    : ${auditEntries.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
