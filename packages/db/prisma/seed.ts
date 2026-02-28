import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5); // "HH:MM"
}

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: { username: "admin", password: await hash("123456"), role: "ADMIN" },
  });

  const aaaUser = await prisma.user.upsert({
    where: { username: "aaa" },
    update: {},
    create: { username: "aaa", password: await hash("aaa"), role: "USER" },
  });

  const createdUsers = await prisma.user.findMany();

  await prisma.staff.createMany({
    data: [
      { name: "Dr. Kai Gao", role: "Doctor" },
      { name: "Dr. Jane Smith", role: "Doctor" },
    ],
    skipDuplicates: true,
  });

  const patients = await prisma.patient.createMany({
    data: [
      {
        firstName: "Emily",
        lastName: "Clark",
        dateOfBirth: new Date("1985-06-15"),
        gender: "female",
        phone: "555-0001",
        email: "emily@example.com",
        address: "101 Apple Rd",
        city: "Newtown",
        zipCode: "10001",
        userId: createdUsers[0].id,
      },
      {
        firstName: "Michael",
        lastName: "Brown",
        dateOfBirth: new Date("1979-09-10"),
        gender: "male",
        phone: "555-0002",
        email: "michael@example.com",
        address: "202 Banana Ave",
        city: "Oldtown",
        zipCode: "10002",
        userId: createdUsers[1].id,
      },
    ],
    skipDuplicates: true,
  });

  const createdPatients = await prisma.patient.findMany();

  const staffMembers = await prisma.staff.findMany();
  if (createdPatients.length >= 2 && createdUsers.length >= 2 && staffMembers.length >= 1) {
    await prisma.appointment.createMany({
      data: [
        {
          patientId: createdPatients[0].id,
          userId: createdUsers[0].id,
          staffId: staffMembers[0].id,
          title: "Initial Consultation",
          date: new Date("2025-06-01"),
          startTime: formatTime(new Date("2025-06-01T10:00:00")),
          endTime: formatTime(new Date("2025-06-01T10:30:00")),
          type: "consultation",
        },
        {
          patientId: createdPatients[1].id,
          userId: createdUsers[1].id,
          staffId: staffMembers[0].id,
          title: "Follow-up",
          date: new Date("2025-06-02"),
          startTime: formatTime(new Date("2025-06-01T10:00:00")),
          endTime: formatTime(new Date("2025-06-01T10:30:00")),
          type: "checkup",
        },
      ],
      skipDuplicates: true,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
