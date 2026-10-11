// Pure scheduling rules. Days are local calendar dates as "YYYY-MM-DD";
// arithmetic goes through UTC so it never depends on the server's offset.

export type Cadence = "daily" | "every_n_days" | "weekly" | "monthly";

export interface TaskRule {
  cadence: string;
  timesPer: number;
  intervalDays: number;
}

export type StatusKind =
  | "done" // nothing more needed today
  | "due" // must be done today; an alert fires if it is not
  | "pending" // on pace, but the period still needs more completions
  | "not_due"; // nothing needed until a later day

export interface TaskStatus {
  kind: StatusKind;
  doneToday: number;
  label: string;
}

const DAY_MS = 86_400_000;

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * DAY_MS);

export const diffDays = (a: string, b: string) => Math.round((toUtc(a) - toUtc(b)) / DAY_MS);

export const localDay = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Weeks run Sunday to Saturday, matching the paper sheet.
export const weekStart = (day: string) => addDays(day, -new Date(toUtc(day)).getUTCDay());

export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

export const daysInMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// Completions a period should hold by the end of day `index` (0-based) so
// the work is spread out: 2x/week needs one by Wednesday and two by
// Saturday, 1x/month needs one by the last day of the month.
export const requiredBy = (index: number, periodDays: number, times: number) =>
  Math.floor(((index + 1) * times) / periodDays);

const periodLabel = (cadence: string) => (cadence === "monthly" ? "this month" : "this week");

export const frequencyLabel = (rule: TaskRule) => {
  switch (rule.cadence) {
    case "daily":
      return "Daily";
    case "every_n_days":
      return `Every ${rule.intervalDays} days`;
    case "weekly":
      return `${rule.timesPer}x / week`;
    case "monthly":
      return `${rule.timesPer}x / month`;
    default:
      return rule.cadence;
  }
};

/**
 * @param days every day this task was completed on or before `today`
 *             (repeats allowed, one entry per completion)
 */
export function taskStatus(rule: TaskRule, days: string[], today: string): TaskStatus {
  const upToToday = days.filter((d) => d <= today);
  const doneToday = upToToday.filter((d) => d === today).length;

  if (rule.cadence === "daily") {
    return doneToday > 0
      ? { kind: "done", doneToday, label: "Done today" }
      : { kind: "due", doneToday, label: "Due today" };
  }

  if (rule.cadence === "every_n_days") {
    if (doneToday > 0) return { kind: "done", doneToday, label: "Done today" };
    const last = upToToday.sort().at(-1);
    if (!last) return { kind: "due", doneToday, label: "Due today" };
    const since = diffDays(today, last);
    if (since >= rule.intervalDays) {
      const late = since - rule.intervalDays;
      return {
        kind: "due",
        doneToday,
        label: late > 0 ? `Overdue by ${late} day${late > 1 ? "s" : ""}` : "Due today",
      };
    }
    const next = rule.intervalDays - since;
    return {
      kind: "not_due",
      doneToday,
      label: next === 1 ? "Due tomorrow" : `Due in ${next} days`,
    };
  }

  const monthly = rule.cadence === "monthly";
  const start = monthly ? monthStart(today) : weekStart(today);
  const periodDays = monthly ? daysInMonth(today) : 7;
  const count = upToToday.filter((d) => d >= start).length;
  const progress = `${Math.min(count, rule.timesPer)}/${rule.timesPer} ${periodLabel(rule.cadence)}`;

  if (count >= rule.timesPer) return { kind: "done", doneToday, label: progress };
  const needed = requiredBy(diffDays(today, start), periodDays, rule.timesPer);
  if (count < needed) return { kind: "due", doneToday, label: `${progress} · due today` };
  return { kind: "pending", doneToday, label: progress };
}
