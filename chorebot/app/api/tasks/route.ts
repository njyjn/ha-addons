import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { parseTaskInput } from "@/lib/taskInput";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tasks = await prisma.task.findMany({
      where: { archived: false },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return fail("Failed to fetch tasks");
  }
}

export async function POST(request: Request) {
  try {
    const parsed = parseTaskInput(await request.json());
    if ("error" in parsed) return fail(parsed.error as string, 400);

    const last = await prisma.task.aggregate({ _max: { sortOrder: true } });
    const task = await prisma.task.create({
      data: { ...parsed.data, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Error creating task:", error);
    return fail("Failed to create task");
  }
}
