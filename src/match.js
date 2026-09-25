import { formatSeconds } from "./config.js";

export function upcomingDates(config, now = new Date()) {
  const dates = [];
  for (let offset = 0; offset <= config.daysAhead; offset += 1) {
    const date = addDays(now, offset, config.timeZone);
    const weekday = weekdayName(date);
    const slots = config.slots.filter((slot) => slot.weekday === weekday);
    if (slots.length) dates.push({ date, weekday, slots });
  }
  return dates;
}

export function normalizeHours(payload) {
  const raw = payload?.available_hours || payload?.hours || [];
  return raw
    .map((hour) => {
      if (typeof hour === "number") {
        return { seconds: hour, available: true, group: null };
      }
      const seconds = Number(hour.seconds_from_midnight ?? hour.seconds ?? hour.hour);
      return {
        seconds,
        available: hour.available !== false,
        group: hour.group ?? null,
        label: hour.formatted_hour || hour.label || null,
      };
    })
    .filter((hour) => Number.isFinite(hour.seconds));
}

export function timeStepFrom(payload, fallback = 1800) {
  const rules = payload?.meta?.specific_rules || {};
  const step = Number(rules.playerBookingTimeStep || rules.time_step || rules.player_booking_time_step);
  return Number.isFinite(step) && step > 0 ? step : fallback;
}

export function matchSlot(hours, slot, step) {
  const start = hours.find((hour) => hour.seconds === slot.startSeconds && hour.available);
  if (!start) return null;

  let selected;
  if (start.group != null) {
    selected = hours
      .filter((hour) => hour.group === start.group && hour.available)
      .map((hour) => hour.seconds)
      .sort((a, b) => a - b);
  } else {
    const count = Math.max(1, Math.round((slot.durationMinutes * 60) / step));
    selected = [];
    for (let index = 0; index < count; index += 1) {
      const seconds = slot.startSeconds + index * step;
      const hour = hours.find((item) => item.seconds === seconds && item.available);
      if (!hour) return null;
      selected.push(seconds);
    }
  }

  const hourEnd = selected[selected.length - 1] + step;
  return {
    seconds: selected,
    hourStart: selected[0],
    hourEnd,
    label: `${formatSeconds(selected[0])}–${formatSeconds(hourEnd)}`,
  };
}

function weekdayName(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .toLowerCase();
}

export function calendarDates(timeZone, count, now = new Date()) {
  const dates = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = addDays(now, offset, timeZone);
    dates.push({ date, weekday: weekdayName(date) });
  }
  return dates;
}

function addDays(now, offset, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + offset, 16, 0, 0));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}

export function dateToUnix(dateString, timeZone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 12, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = asUtc - utcGuess;
  return Math.floor((Date.UTC(year, month - 1, day, 0, 0, 0) - offset) / 1000);
}
