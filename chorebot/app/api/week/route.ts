import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, parseDay } from "@/lib/http";
import { addDays, frequencyLabel, localDay, weekStart } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const start = weekStart(parseDay(new URL(request.url).searchParams.get("date")));
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

    const tasks = await prisma.task.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        completions: { where: { day: { gte: days[0], lte: days[6] } }, select: { day: true } },
      },
    });

    return NextResponse.json({
      success: true,
      today: localDay(),
      days,
      tasks: tasks.map((t) => {
        const counts: Record<string, number> = {};
        for (const c of t.completions) counts[c.day] = (counts[c.day] || 0) + 1;
        return { id: t.id, room: t.room, name: t.name, frequency: frequencyLabel(t), counts };
      }),
    });
  } catch (error) {
    console.error("Error fetching week:", error);
    return fail("Failed to fetch week");
  }
}
