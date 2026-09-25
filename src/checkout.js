import { openSession, ensureLoggedIn } from "./session.js";
import { formatSeconds } from "./config.js";
import { log } from "./logger.js";
import { materializeStorageFromEnv } from "./storage-state.js";

const SECOND_PLAYER = "Eric Placeholder";
const NAME_PATTERN = new RegExp(`^${SECOND_PLAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

let previewSession = null;

export async function closePreviewSession() {
  const session = previewSession;
  previewSession = null;
  if (session) await session.close().catch(() => {});
}

export async function previewCheckout({ bookingUrl, date, surface, seconds, label }) {
  const start = Number(seconds);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Pick a time from the list.");
  if (!String(surface || "").trim()) throw new Error("Pick a time from the list.");
  if (!Number.isFinite(start)) throw new Error("Pick a time from the list.");

  const email = process.env.PBP_EMAIL;
  const password = process.env.PBP_PASSWORD;
  if (!email || !password) {
    throw new Error("Set PBP_EMAIL and PBP_PASSWORD in the container environment.");
  }

  await closePreviewSession();
  materializeStorageFromEnv();
  const session = await openSession(
    {
      timeZone: "America/New_York",
      headless: process.env.HEADLESS !== "false",
    },
    { fresh: false },
  );
  previewSession = session;

  try {
    await session.page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() !== "GET" && request.method() !== "HEAD" && /\/booking_player\b/.test(request.url())) {
        log("checkout: blocked booking submit");
        await route.abort();
        return;
      }
      await route.continue();
    });
    await ensureLoggedIn(session, {
      bookingUrl,
      signInUrl: "https://app.playbypoint.com/users/sign_in",
      email,
      password,
      timeZone: "America/New_York",
      headless: process.env.HEADLESS !== "false",
    });
    await session.page.bringToFront();
    await driveToCheckout(session.page, {
      date: String(date),
      surface: String(surface).trim(),
      seconds: start,
      label: label || formatClock12(start),
    });
    log("checkout: stopped on the checkout page without booking");
    return `Checkout is open and nothing was booked. ${SECOND_PLAYER} was added as the second player. Open the live view to see it. Do not click Book or Pay.`;
  } catch (error) {
    await clearAndScreenshot(session.page);
    throw error;
  }
}

async function driveToCheckout(page, { date, surface, seconds, label }) {
  await selectDate(page, date);
  await selectSurface(page, surface);
  await selectTime(page, label, seconds);
  await page.waitForTimeout(800);

  let playerReady = false;
  for (let step = 0; step < 6; step += 1) {
    await acceptWaiverIfPresent(page);
    await ensureTwoPlayers(page);
    const added = await addSecondPlayer(page);
    if (added === "added" || added === "present") playerReady = true;
    if (playerReady && (await onCheckout(page))) break;
    const moved = await clickProgressButton(page, { allowCheckout: playerReady });
    if (!moved && added === "missing" && !playerReady) {
      throw new Error("Could not find the add-player search. Nothing was booked.");
    }
    if (!moved && playerReady && (await onCheckout(page))) break;
    if (!moved && !playerReady) {
      throw new Error(`Could not add ${SECOND_PLAYER}. Nothing was booked.`);
    }
    await page.waitForTimeout(800);
  }

  const text = await bodyText(page);
  if (!text.includes(SECOND_PLAYER)) {
    throw new Error(`Checkout opened without ${SECOND_PLAYER}. Nothing was booked.`);
  }
  if (!(await onCheckout(page))) {
    throw new Error("Could not reach the checkout page. Nothing was booked.");
  }
}

async function selectDate(page, date) {
  const hints = dateHints(date);
  const byData = page.locator(`[data-date="${date}"], [data-value="${date}"]`);
  if (await byData.count()) {
    await byData.first().click();
    log("checkout: selected date");
    return;
  }
  const labeled = page.getByRole("button", {
    name: new RegExp(`${hints.monthName}\\s+${hints.day}\\b|${hints.weekday}.*\\b${hints.day}\\b`, "i"),
  });
  if (await labeled.count()) {
    await labeled.first().click();
    log("checkout: selected date");
    return;
  }
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const text = (await buttons.nth(index).innerText()).replace(/\s+/g, " ");
    const hasDay = new RegExp(`\\b${hints.day}\\b`).test(text);
    const hasWeekday = text.toLowerCase().includes(hints.weekday.toLowerCase());
    if (hasDay && hasWeekday) {
      await buttons.nth(index).click();
      log("checkout: selected date");
      return;
    }
  }
  const body = await bodyText(page);
  if (body.includes(date) || (body.includes(hints.monthName) && new RegExp(`\\b${hints.day}\\b`).test(body))) {
    log("checkout: date already shown");
    return;
  }
  throw new Error(`Could not select ${date} on the booking page. Nothing was booked.`);
}

async function selectSurface(page, surface) {
  const pattern = new RegExp(`^${escapeRegex(surface)}$`, "i");
  const target = page
    .getByRole("tab", { name: pattern })
    .or(page.getByRole("button", { name: pattern }))
    .or(page.getByRole("radio", { name: pattern }));
  if (await target.count()) {
    await target.first().click();
    log("checkout: selected court type");
    return;
  }
  const text = page.getByText(surface, { exact: true });
  if (await text.count()) {
    await text.first().click();
    log("checkout: selected court type");
    return;
  }
  throw new Error("Could not select that court type. Nothing was booked.");
}

async function selectTime(page, label, seconds) {
  const candidates = [...new Set([label, formatClock12(seconds), formatSeconds(seconds)].filter(Boolean))];
  for (const text of candidates) {
    const exact = page.getByRole("button", { name: text, exact: true });
    if (await exact.count()) {
      await exact.first().click();
      log("checkout: selected time");
      return;
    }
    const pattern = new RegExp(`^\\s*${escapeRegex(text)}\\s*$`);
    const node = page.locator("button, a, [role='button'], li").filter({ hasText: pattern });
    if (await node.count()) {
      await node.first().click();
      log("checkout: selected time");
      return;
    }
  }
  throw new Error(`Could not find ${candidates[0]} on the booking page. Nothing was booked.`);
}

async function acceptWaiverIfPresent(page) {
  const waiver = page.getByText(/waiver/i);
  if (!(await waiver.count())) return;
  const agree = page.getByRole("button", { name: /^(i agree|accept|agree|accept waiver)$/i });
  if (await agree.count()) {
    await agree.first().click();
    log("checkout: accepted waiver");
    await page.waitForTimeout(400);
  }
}

async function ensureTwoPlayers(page) {
  const doubles = page.getByRole("button", { name: /^doubles$/i }).or(page.getByRole("radio", { name: /doubles/i }));
  if (await visibleCount(doubles)) {
    await doubles.first().click();
    log("checkout: selected two players");
    return;
  }
  const labeled = page.getByLabel(/number of players|^players$/i);
  if (await visibleCount(labeled)) {
    const tag = await labeled.first().evaluate((node) => node.tagName.toLowerCase());
    if (tag === "select") {
      await labeled.first().selectOption("2");
      log("checkout: selected two players");
      return;
    }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = readPlayerCount(await bodyText(page));
    if (count === 2 || (count != null && count > 2)) return;
    const plus = page.getByRole("button", { name: /increase players|add a player|^\+$/i });
    if (!(await visibleCount(plus))) return;
    await plus.first().click();
    log("checkout: increased player count");
    await page.waitForTimeout(300);
  }
}

async function addSecondPlayer(page) {
  if ((await bodyText(page)).includes(SECOND_PLAYER)) return "present";
  const box = page
    .getByPlaceholder(/search|player name|add player|name or email/i)
    .or(page.getByRole("textbox", { name: /search|add player|player name/i }));
  if (!(await visibleCount(box))) return "missing";

  const field = box.first();
  await field.click();
  await field.fill("");
  await field.pressSequentially(SECOND_PLAYER, { delay: 40 });
  const option = page
    .getByRole("option", { name: NAME_PATTERN })
    .or(page.locator("[role='listbox']").getByText(NAME_PATTERN))
    .or(page.locator("li").getByText(NAME_PATTERN));
  try {
    await option.first().waitFor({ state: "visible", timeout: 8000 });
  } catch {
    throw new Error(`No PlayByPoint user named ${SECOND_PLAYER} was in the player search. Nothing was booked.`);
  }
  await option.first().click();
  await page.waitForTimeout(400);
  if (!(await bodyText(page)).includes(SECOND_PLAYER)) {
    throw new Error(`Could not add ${SECOND_PLAYER} as the second player. Nothing was booked.`);
  }
  log("checkout: added second player");
  return "added";
}

async function clickProgressButton(page, { allowCheckout }) {
  const names = allowCheckout
    ? [/^proceed to checkout$/i, /^checkout$/i, /^confirm players$/i, /^continue$/i, /^next$/i, /^add players$/i]
    : [/^continue$/i, /^next$/i, /^add players$/i];
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const name = (await button.innerText()).replace(/\s+/g, " ").trim();
    if (!name || isForbidden(name)) continue;
    const rank = names.findIndex((pattern) => pattern.test(name));
    if (rank === -1) continue;
    if (!best || rank < best.rank) best = { button, name, rank };
  }
  if (!best) return false;
  await best.button.click();
  log(`checkout: continued with "${best.name}"`);
  return true;
}

async function onCheckout(page) {
  const text = await bodyText(page);
  if (/payment method|credit card|club credits|debit card|pay later/i.test(text)) return true;
  return (await page.getByRole("heading", { name: /checkout|payment/i }).count()) > 0;
}

function isForbidden(name) {
  if (/^confirm players$/i.test(name)) return false;
  return /^(book|book now|pay|pay now|confirm|confirm booking|confirm reservation|reserve|place order|complete booking|complete reservation|submit|submit payment)\b/i.test(
    name,
  );
}

function readPlayerCount(text) {
  const match = text.match(/(\d+)\s+players?/i);
  return match ? Number(match[1]) : null;
}

function dateHints(date) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  return {
    day: String(day),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(utc),
    monthName: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(utc),
  };
}

function formatClock12(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function bodyText(page) {
  return page.locator("body").innerText();
}

async function visibleCount(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function clearAndScreenshot(page) {
  await page
    .evaluate(() => {
      for (const id of ["user_email", "user_password"]) {
        const field = document.getElementById(id);
        if (field) field.value = "";
      }
    })
    .catch(() => {});
  await page.screenshot({ path: "checkout-stopped.png", fullPage: true }).catch(() => {});
}
