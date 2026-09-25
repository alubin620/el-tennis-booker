import { log, summarizeBody } from "./logger.js";

export async function apiGet(page, path, params = {}, label = path) {
  log(`apiGET start: ${label} params=${JSON.stringify(params)}`);
  const result = await page.evaluate(
    async ({ path, params }) => {
      const url = new URL(path, location.origin);
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
      const response = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text.slice(0, 300);
      }
      return {
        status: response.status,
        url: url.toString(),
        body,
        contentType: response.headers.get("content-type"),
      };
    },
    { path, params },
  );
  log(`apiGET done: ${label} status=${result.status} ctype=${result.contentType ?? ""}`);
  log(`apiGET body: ${summarizeBody(result.body)}`);
  return result;
}

export async function apiPost(page, path, payload, label = path) {
  log(`apiPOST start: ${label}`);
  const result = await page.evaluate(async ({ path, payload }) => {
    const token = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }
    return {
      status: response.status,
      body,
      csrfPresent: Boolean(token),
      contentType: response.headers.get("content-type"),
    };
  }, { path, payload });
  log(`apiPOST done: ${label} status=${result.status} csrf=${result.csrfPresent}`);
  log(`apiPOST body: ${summarizeBody(result.body)}`);
  return result;
}

export async function listCourtTypes(page, facilityId, kind) {
  const result = await apiGet(page, `/api/facilities/${facilityId}/court_types`, { kind }, "court_types");
  if (result.status >= 400) {
    throw new Error(`court_types failed (${result.status}). The session may have expired.`);
  }
  return Array.isArray(result.body) ? result.body : [];
}

export async function listHours(page, facilityId, { timestamp, surface, kind }) {
  const result = await apiGet(
    page,
    `/api/facilities/${facilityId}/available_hours`,
    { timestamp, surface, kind },
    "available_hours",
  );
  if (result.status >= 400) {
    throw new Error(`available_hours failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body || { available_hours: [], meta: {} };
}

export async function listCourts(page, facilityId, { date, surface, startHour, hourEnd, kind }) {
  const result = await apiGet(
    page,
    `/api/facilities/${facilityId}/available_courts`,
    { date, surface, start_hour: startHour, hour_end: hourEnd, kind },
    "available_courts",
  );
  if (result.status >= 400) {
    throw new Error(`available_courts failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return Array.isArray(result.body) ? result.body : [];
}

export async function listCards(page) {
  const result = await apiGet(page, "/api/cards", {}, "cards");
  if (result.status >= 400) return [];
  return Array.isArray(result.body) ? result.body : [];
}

export async function bookCourt(page, courtId, payload) {
  return apiPost(page, `/api/courts/${courtId}/booking_player`, payload, "booking_player");
}
