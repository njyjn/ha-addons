"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

type Kind = "done" | "due" | "pending" | "not_due";

interface Chore {
  id: number;
  room: string;
  name: string;
  cadence: string;
  timesPer: number;
  intervalDays: number;
  frequency: string;
  status: { kind: Kind; doneToday: number; label: string };
}

interface WeekTask {
  id: number;
  room: string;
  name: string;
  frequency: string;
  counts: Record<string, number>;
}

interface TaskForm {
  id?: number;
  room: string;
  name: string;
  cadence: string;
  timesPer: number;
  intervalDays: number;
}

const EMPTY_FORM: TaskForm = { room: "", name: "", cadence: "daily", timesPer: 1, intervalDays: 2 };

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const toLocalDateString = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const shiftDay = (day: string, n: number) => {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + n);
  return toLocalDateString(date);
};

const formatDay = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", opts);

const SECTIONS: { kind: Kind; title: string }[] = [
  { kind: "due", title: "To do today" },
  { kind: "pending", title: "Coming up this week / month" },
  { kind: "done", title: "Done" },
  { kind: "not_due", title: "Not due today" },
];

const STYLES = `
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }
  .header { background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); padding-top: 1rem; }
  .title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  h1 { margin: 0; font-size: 1.75rem; color: #333; }
  .pill { padding: 0.5rem 1rem; font-size: 0.85rem; color: #4a90e2; background: #e8f4fd; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .nav { display: flex; justify-content: center; align-items: center; }
  .nav button { height: 56px; padding: 0 1.4rem; font-size: 1.8rem; background: #f8f9fa; border: 1px solid #e0e0e0; cursor: pointer; color: #333; }
  .nav button:first-child { border-radius: 12px 0 0 12px; }
  .nav button:last-child { border-radius: 0 12px 12px 0; }
  .nav .label { height: 56px; min-width: 220px; display: flex; align-items: center; justify-content: center; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 1.05rem; font-weight: 600; color: #333; background: #fff; }
  .tabs { display: flex; margin-top: 0.75rem; }
  .tab { flex: 1; padding: 0.9rem; border: none; background: #f5f5f5; color: #666; font-size: 0.95rem; font-weight: 600; cursor: pointer; border-bottom: 3px solid transparent; }
  .tab.active { background: #fff; color: #4a90e2; border-bottom-color: #4a90e2; }
  .reminders { background: #fdecea; border: 2px solid #e57373; border-radius: 12px; padding: 0.75rem 1rem; margin: 1rem 0 0; color: #b71c1c; }
  .reminders strong { display: block; margin-bottom: 0.35rem; letter-spacing: 0.03em; }
  .reminders ol { margin: 0; padding-left: 1.25rem; }
  .progress { margin: 1rem 0; background: #fff; border-radius: 12px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .bar { height: 10px; background: #eee; border-radius: 5px; overflow: hidden; margin-top: 0.5rem; }
  .bar > div { height: 100%; background: #43a047; transition: width 0.3s; }
  .section h2 { font-size: 1rem; color: #666; margin: 1.25rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .chore { display: flex; align-items: center; gap: 1rem; width: 100%; text-align: left; background: #fff; border: 1px solid #e6e6e6; border-radius: 12px; padding: 0.9rem 1rem; margin-bottom: 0.5rem; cursor: pointer; font-size: 1rem; }
  .chore:disabled { cursor: default; opacity: 0.6; }
  .chore.due { border-left: 5px solid #e53935; }
  .chore.pending { border-left: 5px solid #fb8c00; }
  .chore.done { border-left: 5px solid #43a047; }
  .chore.not_due { border-left: 5px solid #bdbdbd; opacity: 0.75; }
  .check { flex: none; width: 36px; height: 36px; border-radius: 8px; border: 2px solid #bbb; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; color: #fff; }
  .check.ticked { background: #43a047; border-color: #43a047; }
  .chore-main { flex: 1; min-width: 0; }
  .chore-name { font-weight: 600; color: #222; }
  .chore-meta { font-size: 0.85rem; color: #777; margin-top: 0.15rem; }
  .chore-status { font-size: 0.85rem; color: #555; white-space: nowrap; }
  .grid-wrap { overflow-x: auto; margin: 1rem 0; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border-bottom: 1px solid #eee; padding: 0.5rem; text-align: left; }
  th { background: #fafafa; color: #555; position: sticky; top: 0; }
  td.cell, th.cell { text-align: center; width: 56px; padding: 0; }
  td.cell button { width: 100%; height: 44px; border: none; background: transparent; cursor: pointer; font-size: 1.1rem; color: #43a047; font-weight: 700; }
  td.cell button:disabled { cursor: default; }
  .today-col { background: #e8f4fd !important; }
  .form { background: #fff; border-radius: 12px; padding: 1rem; margin: 1rem 0; box-shadow: 0 1px 3px rgba(0,0,0,0.06); display: grid; grid-template-columns: 1fr 1.5fr 1fr 0.6fr auto; gap: 0.5rem; align-items: end; }
  .form label { font-size: 0.8rem; color: #666; display: flex; flex-direction: column; gap: 0.25rem; }
  .form input, .form select { padding: 0.6rem; font-size: 0.95rem; border: 1px solid #ddd; border-radius: 8px; }
  .primary { padding: 0.65rem 1.1rem; background: #4a90e2; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .link { background: none; border: none; color: #4a90e2; cursor: pointer; font-weight: 600; padding: 0.25rem 0.5rem; }
  .link.danger { color: #e53935; }
  @media (max-width: 768px) {
    .form { grid-template-columns: 1fr; }
    .nav .label { min-width: 160px; font-size: 0.95rem; }
  }
`;

export default function Home() {
  const [view, setView] = useState<"today" | "week" | "manage">("today");
  const [selectedDay, setSelectedDay] = useState(() => toLocalDateString(new Date()));
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);

  const { data: status, mutate: mutateStatus } = useSWR(`/api/status?date=${selectedDay}`, fetcher, {
    refreshInterval: 60_000,
  });
  const { data: week, mutate: mutateWeek } = useSWR(
    view === "week" ? `/api/week?date=${selectedDay}` : null,
    fetcher,
    { refreshInterval: 60_000 },
  );
  const { data: tasksData, mutate: mutateTasks } = useSWR(view === "manage" ? "/api/tasks" : null, fetcher);

  const today: string = status?.today ?? toLocalDateString(new Date());
  const chores: Chore[] = status?.chores ?? [];
  const reminders: string[] = status?.reminders ?? [];
  const remindersTitle: string = status?.remindersTitle ?? "";

  // Roll the kiosk over to the new day at midnight if it was showing today.
  useEffect(() => {
    const id = setInterval(() => {
      const now = toLocalDateString(new Date());
      setSelectedDay((current) => (current === shiftDay(now, -1) ? now : current));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = () => Promise.all([mutateStatus(), mutateWeek()]);

  const tick = async (taskId: number, day: string, remove: boolean) => {
    if (busy || day > today) return;
    setBusy(true);
    try {
      if (remove) {
        await fetch(`/api/completions?taskId=${taskId}&day=${day}`, { method: "DELETE" });
      } else {
        await fetch("/api/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, day }),
        });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveTask = async () => {
    const res = await fetch(form.id ? `/api/tasks/${form.id}` : "/api/tasks", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    if (!json.success) {
      alert(json.error);
      return;
    }
    setForm(EMPTY_FORM);
    await Promise.all([mutateTasks(), refresh()]);
  };

  const archiveTask = async (id: number, name: string) => {
    if (!confirm(`Remove "${name}"? Past ticks are kept.`)) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await Promise.all([mutateTasks(), refresh()]);
  };

  // What today asks for: everything due, plus whatever was ticked off today.
  const scheduled = chores.filter((c) => c.status.kind === "due" || c.status.doneToday > 0);
  const doneCount = scheduled.filter((c) => c.status.doneToday > 0).length;
  const weekStartDay: string | undefined = week?.days?.[0];

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f8f9fa", paddingBottom: "2rem" }}>
      <style>{STYLES}</style>

      <div className="header">
        <div className="wrap">
          <div className="title-row">
            <h1>ChoreBot</h1>
            {selectedDay !== today && (
              <button className="pill" onClick={() => setSelectedDay(today)}>
                Today
              </button>
            )}
          </div>

          {view !== "manage" && (
            <div className="nav">
              <button onClick={() => setSelectedDay(shiftDay(selectedDay, view === "week" ? -7 : -1))}>‹</button>
              <div className="label">
                {view === "week" && weekStartDay
                  ? `Week of ${formatDay(weekStartDay, { day: "numeric", month: "short" })}`
                  : formatDay(selectedDay, { weekday: "long", day: "numeric", month: "short" })}
              </div>
              <button onClick={() => setSelectedDay(shiftDay(selectedDay, view === "week" ? 7 : 1))}>›</button>
            </div>
          )}

          <div className="tabs">
            {(["today", "week", "manage"] as const).map((v) => (
              <button key={v} className={`tab ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
                {v === "today" ? "Checklist" : v === "week" ? "Week" : "Manage"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wrap">
        {reminders.length > 0 && (
          <div className="reminders">
            {remindersTitle && <strong>{remindersTitle}</strong>}
            <ol>
              {reminders.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </div>
        )}

        {view === "today" && (
          <>
            <div className="progress">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  {doneCount} / {scheduled.length} done
                </strong>
                {status?.helperName && <span style={{ color: "#777" }}>Helper: {status.helperName}</span>}
              </div>
              <div className="bar">
                <div style={{ width: `${scheduled.length ? (doneCount / scheduled.length) * 100 : 0}%` }} />
              </div>
            </div>

            {SECTIONS.map(({ kind, title }) => {
              const items = chores.filter((c) => c.status.kind === kind);
              if (items.length === 0) return null;
              return (
                <div className="section" key={kind}>
                  <h2>
                    {title} ({items.length})
                  </h2>
                  {items.map((c) => (
                    <button
                      key={c.id}
                      className={`chore ${kind}`}
                      disabled={busy || selectedDay > today}
                      onClick={() => tick(c.id, selectedDay, c.status.doneToday > 0)}
                    >
                      <span className={`check ${c.status.doneToday > 0 ? "ticked" : ""}`}>
                        {c.status.doneToday > 0 ? "✓" : ""}
                      </span>
                      <span className="chore-main">
                        <div className="chore-name">{c.name}</div>
                        <div className="chore-meta">
                          {c.room} · {c.frequency}
                        </div>
                      </span>
                      <span className="chore-status">
                        {c.status.label}
                        {c.status.doneToday > 1 ? ` · ✓×${c.status.doneToday}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </>
        )}

        {view === "week" && week?.days && (
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Task</th>
                  <th>Frequency</th>
                  {week.days.map((d: string) => (
                    <th key={d} className={`cell ${d === today ? "today-col" : ""}`}>
                      {formatDay(d, { weekday: "short" })}
                      <br />
                      {formatDay(d, { day: "numeric" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {week.tasks.map((t: WeekTask) => (
                  <tr key={t.id}>
                    <td style={{ color: "#777" }}>{t.room}</td>
                    <td>{t.name}</td>
                    <td style={{ color: "#777", whiteSpace: "nowrap" }}>{t.frequency}</td>
                    {week.days.map((d: string) => {
                      const n = t.counts[d] || 0;
                      return (
                        <td key={d} className={`cell ${d === today ? "today-col" : ""}`}>
                          <button disabled={busy || d > today} onClick={() => tick(t.id, d, n > 0)}>
                            {n > 1 ? `✓×${n}` : n === 1 ? "✓" : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === "manage" && (
          <>
            <div className="form">
              <label>
                Room
                <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
              </label>
              <label>
                Task
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Frequency
                <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="every_n_days">Every N days</option>
                  <option value="weekly">Per week</option>
                  <option value="monthly">Per month</option>
                </select>
              </label>
              <label>
                {form.cadence === "every_n_days" ? "Days" : "Times"}
                <input
                  type="number"
                  min={form.cadence === "every_n_days" ? 2 : 1}
                  disabled={form.cadence === "daily"}
                  value={form.cadence === "every_n_days" ? form.intervalDays : form.timesPer}
                  onChange={(e) =>
                    setForm(
                      form.cadence === "every_n_days"
                        ? { ...form, intervalDays: Number(e.target.value) }
                        : { ...form, timesPer: Number(e.target.value) },
                    )
                  }
                />
              </label>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <button className="primary" onClick={saveTask}>
                  {form.id ? "Save" : "Add"}
                </button>
                {form.id && (
                  <button className="link" onClick={() => setForm(EMPTY_FORM)}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="grid-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Task</th>
                    <th>Frequency</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(tasksData?.tasks ?? []).map((t: TaskForm & { id: number }) => (
                    <tr key={t.id}>
                      <td style={{ color: "#777" }}>{t.room}</td>
                      <td>{t.name}</td>
                      <td style={{ color: "#777" }}>
                        {chores.find((c) => c.id === t.id)?.frequency ?? t.cadence}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="link" onClick={() => setForm(t)}>
                          Edit
                        </button>
                        <button className="link danger" onClick={() => archiveTask(t.id, t.name)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
