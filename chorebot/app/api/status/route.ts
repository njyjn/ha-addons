import { NextResponse } from "next/server";
import { choresForDay } from "@/lib/chores";
import { getOptions } from "@/lib/config";
import { fail, parseDay } from "@/lib/http";
import { localDay } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const day = parseDay(new URL(request.url).searchParams.get("date"));
    const chores = await choresForDay(day);
    const { helperName, reminders, remindersTitle, alertTime } = getOptions();
    return NextResponse.json({
      success: true,
      day,
      today: localDay(),
      chores,
      helperName,
      reminders,
      remindersTitle,
      alertTime,
    });
  } catch (error) {
    console.error("Error fetching status:", error);
    return fail("Failed to fetch status");
  }
}
