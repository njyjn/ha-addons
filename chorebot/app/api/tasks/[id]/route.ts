import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { parseTaskInput } from "@/lib/taskInput";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = parseTaskInput(await request.json());
    if ("error" in parsed) return fail(parsed.error as string, 400);

    const task = await prisma.task.update({ where: { id: Number(params.id) }, data: parsed.data });
    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Error updating task:", error);
    return fail("Failed to update task");
  }
}

// Archived rather than deleted so past ticks stay in the history.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.task.update({ where: { id: Number(params.id) }, data: { archived: true } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error archiving task:", error);
    return fail("Failed to archive task");
  }
}
