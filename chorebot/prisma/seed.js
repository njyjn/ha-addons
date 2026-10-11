// Seeds the chore list from the Weekly Household Chore Tracker sheet.
// Runs on every start but only writes when the Task table is empty, so
// edits made in the app are never overwritten.
const { PrismaClient } = require("@prisma/client");

const TASKS = [
  ["Living, Baby & Master Room", "Vacuum and steam carpet", "daily"],
  ["Whole House", "Vacuum and mop floor", "daily"],
  ["Baby & Master Room", "Make bed", "daily"],
  ["Zara, Master Toilet", "Clean toilet and check toilet paper", "daily"],
  ["Living, Baby, Master Room", "Wipe ALL tables", "daily"],
  ["Whole House", "Wipe bay window", "daily"],
  ["Living Room", "Wipe mirror", "daily"],
  ["Service Yard", "Wipe table", "daily"],
  ["Kitchen", "Clean kitchen after cooking", "daily"],
  ["Kitchen", "Clean kitchen sink", "daily"],
  ["Whole House", "Clear dustbin and put back plastic", "daily"],
  ["Kitchen", "Clean milk dispenser", "daily"],
  ["Zara Toilet", "Spray diaper bin", "daily"],
  ["Zara Toilet", "Wash diaper bin", "every_n_days", { intervalDays: 2 }],
  ["Zara, Master Toilet", "Replace toilet hand towel", "every_n_days", { intervalDays: 2 }],
  ["Kitchen", "Clean microwave and toaster rack", "weekly", { timesPer: 2 }],
  ["Baby & Master Room", "Change bedsheets, duvet & pillowcases", "weekly", { timesPer: 2 }],
  ["Living Room", "Clean ALL chairs & sofa", "weekly"],
  ["Whole House", "Wipe fan", "weekly"],
  ["Whole House", "Wipe blinds", "weekly"],
  ["Whole House", "Check desiccant to replace", "weekly"],
  ["Kitchen", "Clean fridge", "weekly"],
  ["Kitchen", "Clean sponges", "weekly"],
  ["Service Yard", "Clean washing machine", "monthly"],
];

async function main() {
  const prisma = new PrismaClient();
  try {
    if ((await prisma.task.count()) > 0) {
      console.log("Tasks already present, skipping seed");
      return;
    }
    await prisma.task.createMany({
      data: TASKS.map(([room, name, cadence, extra], i) => ({
        room,
        name,
        cadence,
        sortOrder: i,
        ...extra,
      })),
    });
    console.log(`Seeded ${TASKS.length} tasks`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
