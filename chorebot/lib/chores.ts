import { prisma } from "@/lib/prisma";
import { getOptions } from "@/lib/config";
import { setState } from "@/lib/homeassistant";
import { addDays, frequencyLabel, monthStart, taskStatus, TaskStatus, weekStart } from "@/lib/schedule";

export interface ChoreView {
  id: number;
  room: string;
  name: string;
  cadence: string;
  timesPer: number;
  intervalDays: number;
  frequency: string;
  status: TaskStatus;
}

// Far enough back to cover the current month and any every-N-days interval.
const lookbackStart = (day: string) => {
  const candidates = [monthStart(day), weekStart(day), addDays(day, -60)];
  return candidates.sort()[0];
};

export async function choresForDay(day: string): Promise<ChoreView[]> {
  const tasks = await prisma.task.findMany({
    where: { archived: false },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      completions: {
        where: { day: { gte: lookbackStart(day), lte: day } },
        select: { day: true },
      },
    },
  });

  return tasks.map((t) => ({
    id: t.id,
    room: t.room,
    name: t.name,
    cadence: t.cadence,
    timesPer: t.timesPer,
    intervalDays: t.intervalDays,
    frequency: frequencyLabel(t),
    status: taskStatus(
      t,
      t.completions.map((c) => c.day),
      day,
    ),
  }));
}

export function summarize(chores: ChoreView[]) {
  const due = chores.filter((c) => c.status.kind === "due");
  const doneToday = chores.filter((c) => c.status.doneToday > 0).length;
  return { due, doneToday };
}

export async function publishSensor(day: string, chores?: ChoreView[]) {
  const list = chores ?? (await choresForDay(day));
  const { due, doneToday } = summarize(list);
  await setState("sensor.chorebot_outstanding", due.length, {
    friendly_name: "Chores outstanding",
    icon: due.length ? "mdi:broom" : "mdi:check-all",
    unit_of_measurement: "tasks",
    state_class: "measurement",
    day,
    done_today: doneToday,
    helper: getOptions().helperName || null,
    outstanding: due.map((c) => `${c.name} (${c.room})`),
  });
}
