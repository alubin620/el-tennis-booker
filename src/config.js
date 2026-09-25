import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function configPath() {
  return resolve(process.env.CONFIG_PATH || "booking.config.json");
}

export function loadConfig() {
  const path = configPath();
  let file;
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path}. Open the settings page and save a booking config. (${error.message})`,
    );
  }

  const email = process.env.PBP_EMAIL;
  const password = process.env.PBP_PASSWORD;
  if (!email || !password) {
    throw new Error("Set PBP_EMAIL and PBP_PASSWORD in the environment or a .env file.");
  }

  return {
    ...bookingFromFile(file),
    email,
    password,
    notifyWebhook: process.env.NOTIFY_WEBHOOK || "",
    headless: process.env.HEADLESS !== "false",
  };
}

export function bookingFromFile(file) {
  const facilitySlug = requiredText(file.facilitySlug, "facilitySlug");
  const facilityId = requiredNumber(file.facilityId, "facilityId");
  const timeZone = requiredText(file.timeZone, "timeZone");
  const surface = requiredText(file.surface, "surface");
  const players = requiredNumber(file.players, "players");
  const paymentMethod = requiredText(file.paymentMethod, "paymentMethod");
  if (!["card", "prepaid"].includes(paymentMethod)) {
    throw new Error('paymentMethod must be "card" or "prepaid".');
  }
  const daysAhead = requiredNumber(file.daysAhead, "daysAhead");
  const pollIntervalSeconds = Number(file.pollIntervalSeconds || 20);
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error("pollIntervalSeconds must be a positive number.");
  }

  const slots = (file.slots || []).map((slot) => {
    const weekday = String(slot.weekday || "").toLowerCase();
    if (!WEEKDAYS.includes(weekday)) {
      throw new Error(`Unknown weekday "${slot.weekday}". Use monday through sunday.`);
    }
    const start = String(slot.start || "").trim();
    const startSeconds = parseClock(start);
    const durationMinutes = Number(slot.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new Error(`Invalid durationMinutes for ${weekday} ${start}.`);
    }
    return { weekday, start, startSeconds, durationMinutes };
  });

  if (slots.length === 0) {
    throw new Error("Add at least one preferred slot.");
  }

  return {
    facilitySlug,
    facilityId,
    timeZone,
    kind: file.kind || "reservation",
    surface,
    players,
    paymentMethod,
    dryRun: file.dryRun !== false,
    pollIntervalSeconds,
    daysAhead,
    slots,
    bookingUrl: `https://app.playbypoint.com/book/${facilitySlug}`,
    signInUrl: "https://app.playbypoint.com/users/sign_in",
  };
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Set ${label} in the settings page.`);
  return text;
}

function requiredNumber(value, label) {
  if (value == null || value === "") throw new Error(`Set ${label} in the settings page.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number.`);
  return number;
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) throw new Error(`Invalid start time "${value}". Use HH:MM.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid start time "${value}".`);
  return hours * 3600 + minutes * 60;
}

export function formatSeconds(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
