import { readFileSync } from "fs";

export interface Options {
  helperName: string;
  alertTime: string;
  notifyService: string;
  notifyTarget: string;
  slackWebhookUrl: string;
  reminders: string[];
  remindersTitle: string;
}

// Read on every call so option changes apply after an add-on restart
// without a rebuild, and local dev works with no options file at all.
export function getOptions(): Options {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(process.env.OPTIONS_PATH || "/data/options.json", "utf8"));
  } catch {
    // no options file outside Home Assistant
  }
  const str = (key: string, fallback = "") =>
    typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : fallback;

  return {
    helperName: str("helper_name"),
    alertTime: str("alert_time", "20:00"),
    notifyService: str("notify_service"),
    notifyTarget: str("notify_target"),
    slackWebhookUrl: str("slack_webhook_url", process.env.SLACK_WEBHOOK_URL || ""),
    remindersTitle: str("reminders_title"),
    reminders: Array.isArray(raw.reminders) ? (raw.reminders as string[]) : [],
  };
}
