import { openSession, ensureLoggedIn, readFacility } from "./session.js";
import { listCourtTypes, listHours } from "./api.js";
import { formatSeconds } from "./config.js";
import { calendarDates, dateToUnix, normalizeHours } from "./match.js";
import { materializeStorageFromEnv } from "./storage-state.js";

const DAYS = 3;

export function bookingUrlFromInput(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Paste a PlayByPoint booking link.");
  if (/^\d+$/.test(value)) {
    throw new Error("Paste the booking link, not only the facility number.");
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    const match = url.pathname.match(/\/book\/([^/]+)/);
    if (!match) throw new Error("That link is not a PlayByPoint booking page.");
    return `https://app.playbypoint.com/book/${match[1]}`;
  }
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    throw new Error("Paste a booking link like https://app.playbypoint.com/book/yourclub");
  }
  return `https://app.playbypoint.com/book/${value}`;
}

export async function lookupAvailability(bookingUrl) {
  const email = process.env.PBP_EMAIL;
  const password = process.env.PBP_PASSWORD;
  if (!email || !password) {
    throw new Error("Set PBP_EMAIL and PBP_PASSWORD in the container environment.");
  }

  materializeStorageFromEnv();
  const session = await openSession(
    {
      timeZone: "America/New_York",
      headless: process.env.HEADLESS !== "false",
    },
    { fresh: false },
  );
  try {
    await ensureLoggedIn(session, {
      bookingUrl,
      signInUrl: "https://app.playbypoint.com/users/sign_in",
      email,
      password,
      timeZone: "America/New_York",
      headless: process.env.HEADLESS !== "false",
    });
    const facility = await readFacility(session.page);
    if (!facility?.facilityId) throw new Error("The booking page did not load a facility.");
    if (!facility.userId) throw new Error("Signed in, but PlayByPoint still shows a logged-out booking page.");

    const types = await listCourtTypes(session.page, facility.facilityId, "reservation");
    const surfaces = types.map((type) => String(type.surface || "")).filter(Boolean);
    if (!surfaces.length) throw new Error("No court types were returned for this account.");

    const dates = calendarDates(facility.timeZone || "America/New_York", DAYS);
    const days = [];
    for (const day of dates) {
      const timestamp = dateToUnix(day.date, facility.timeZone || "America/New_York");
      const bySurface = [];
      for (const surface of surfaces) {
        const payload = await listHours(session.page, facility.facilityId, {
          timestamp,
          surface,
          kind: "reservation",
        });
        const hours = normalizeHours(payload);
        bySurface.push({ surface, slots: openSlots(hours) });
      }
      days.push({ ...day, surfaces: bySurface });
    }

    return {
      bookingUrl,
      facilityId: facility.facilityId,
      timeZone: facility.timeZone,
      nextOpen: facility.nextOpenScheduleDateTime || "",
      days,
    };
  } finally {
    await session.close();
  }
}

export function openSlots(hours) {
  return hours
    .filter((hour) => hour.available)
    .map((hour) => ({
      seconds: hour.seconds,
      label: hour.label || formatSeconds(hour.seconds),
    }))
    .sort((a, b) => a.seconds - b.seconds);
}
