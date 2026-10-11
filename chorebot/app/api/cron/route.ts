import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ChoreView, choresForDay, publishSensor, summarize } from "@/lib/chores";
import { getOptions } from "@/lib/config";
import { notify } from "@/lib/homeassistant";
import { fail } from "@/lib/http";
import { notifySlack } from "@/lib/slack";
import { localDay } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const formatDigest = (day: string, due: ChoreView[]) => {
  const date = new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const lines = due.map((c) => `• ${c.name} (${c.room}) · ${c.status.label}`);
  return `🧹 ${due.length} chore${due.length > 1 ? "s" : ""} not done for ${date}\n${lines.join("\n")}`;
};

// Ticked every minute by start.sh. Keeps the Home Assistant sensor fresh and
// sends one digest per day once the alert time has passed. POST ?test=1 sends
// the digest immediately without recording it, for checking notifications.
export async function POST(request: Request) {
  try {
    const test = new URL(request.url).searchParams.get("test") === "1";
    const options = getOptions();
    const now = new Date();
    const day = localDay(now);
    const chores = await choresForDay(day);
    await publishSensor(day, chores);

    const hhmm = now.toTimeString().slice(0, 5);
    if (!test && hhmm < options.alertTime) return NextResponse.json({ success: true, sent: false });
    if (!test && (await prisma.alertLog.findUnique({ where: { day } }))) {
      return NextResponse.json({ success: true, sent: false });
    }

    const { due } = summarize(chores);
    if (due.length > 0) {
      const message = formatDigest(day, due);
      if (options.notifyService) {
        await notify(options.notifyService, message, "ChoreBot", options.notifyTarget || undefined);
      }
      await notifySlack(options.slackWebhookUrl, message);
    }
    if (!test) await prisma.alertLog.create({ data: { day, count: due.length } });

    return NextResponse.json({ success: true, sent: due.length > 0, count: due.length });
  } catch (error) {
    console.error("Error running cron:", error);
    return fail("Failed to run cron");
  }
}
