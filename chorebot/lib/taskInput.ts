const CADENCES = ["daily", "every_n_days", "weekly", "monthly"];

const clampInt = (value: unknown, min: number, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

export function parseTaskInput(body: Record<string, unknown>) {
  const room = String(body.room ?? "").trim();
  const name = String(body.name ?? "").trim();
  const cadence = String(body.cadence ?? "");
  if (!room || !name) return { error: "Room and task are required" } as const;
  if (!CADENCES.includes(cadence)) return { error: "Unknown frequency" } as const;

  return {
    data: {
      room,
      name,
      cadence,
      timesPer: cadence === "weekly" || cadence === "monthly" ? clampInt(body.timesPer, 1, 31) : 1,
      intervalDays: cadence === "every_n_days" ? clampInt(body.intervalDays, 2, 365) : 1,
    },
  } as const;
}
