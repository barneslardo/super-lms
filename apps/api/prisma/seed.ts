import { PrismaClient } from "@prisma/client";
import { catalogEntryForCode } from "@lms/shared";

const prisma = new PrismaClient();

async function main() {
  for (const code of ["CS101", "MATH201", "ENG102"]) {
    const entry = catalogEntryForCode(code);
    const existing = await prisma.course.findUnique({ where: { code } });
    if (existing) continue;
    await prisma.course.create({
      data: {
        code: entry.code,
        title: entry.title,
        majorTag: entry.majorTag,
        description: entry.description,
        modules: {
          create: entry.modules.map((m) => ({
            title: m.title,
            body: m.body,
            order: m.order,
          })),
        },
        assignments: {
          create: entry.assignments.map((a) => ({
            title: a.title,
            body: a.body,
            order: a.order,
          })),
        },
      },
    });
    console.log(`Seeded course ${code}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
