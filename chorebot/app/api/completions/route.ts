import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishSensor } from "@/lib/chores";
import { getOptions } from "@/lib/config";
import { fail, parseDay } from "@/lib/http";
import { localDay } from "@/lib/schedule";

const refreshSensor = () =>
  publishSensor(localDay()).catch((error) => console.error("Sensor update failed:", error));

export async function POST(request: Request) {
  try {
    const { taskId, day } = await request.json();
    const target = parseDay(day);
    if (target > localDay()) return fail("Cannot complete a future day", 400);

    const completion = await prisma.completion.create({
      data: {
        taskId: Number(taskId),
        day: target,
        completedBy: getOptions().helperName || null,
      },
    });
    await refreshSensor();
    return NextResponse.json({ success: true, completion });
  } catch (error) {
    console.error("Error adding completion:", error);
    return fail("Failed to add completion");
  }
}

// Removes the most recent completion of a task on a day (undo one tick).
export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const taskId = Number(params.get("taskId"));
    const day = parseDay(params.get("day"));

    const latest = await prisma.completion.findFirst({
      where: { taskId, day },
      orderBy: { completedAt: "desc" },
    });
    if (!latest) return fail("No completion to remove", 404);

    await prisma.completion.delete({ where: { id: latest.id } });
    await refreshSensor();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing completion:", error);
    return fail("Failed to remove completion");
  }
}
