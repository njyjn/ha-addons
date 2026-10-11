// Talks to Home Assistant Core through the Supervisor proxy. The token is
// only present when the add-on runs with homeassistant_api: true.
const API = process.env.HA_API_URL || "http://supervisor/core/api";

async function call(path: string, body: unknown) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`Home Assistant ${path} returned ${res.status}`);
    return res.ok;
  } catch (error) {
    console.error(`Home Assistant ${path} failed:`, error);
    return false;
  }
}

export function setState(entityId: string, state: string | number, attributes: Record<string, unknown>) {
  return call(`/states/${entityId}`, { state: String(state), attributes });
}

/** @param service "notify.nswuco" or just "nswuco" */
export function notify(service: string, message: string, title: string, target?: string) {
  const name = service.replace(/^notify\./, "");
  return call(`/services/notify/${name}`, { message, title, ...(target ? { target } : {}) });
}
