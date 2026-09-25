import { openSession, ensureLoggedIn } from "./session.js";
import { log } from "./logger.js";
import { materializeStorageFromEnv } from "./storage-state.js";

const SECOND_PLAYER = "Eric Placeholder";

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
      label: String(label || "").trim(),
    });
    log("checkout: stopped on the Book page");
    return "The Book page is open and nothing was booked. Open the live view to see it. Do not click Book or Pay.";
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

  await acceptWaiverIfPresent(page);
  await clickEnabledNext(page);
  await selectTwoUsers(page);
  await openAddUsersSearch(page);
  await typeAndAddPlayer(page);
  await clickEnabledNext(page);
  await waitForBookPage(page);
}

const SLOT_RANGE =
  /^(\d{1,2})(?::(\d{2}))?(?:\s*(a\.?m\.?|p\.?m\.?))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?:\s*\+)?$/i;

export function parseSlotLabel(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const match = source.match(SLOT_RANGE);
  if (!match) return null;
  const startMinute = Number(match[2] || 0);
  const endMinute = Number(match[5] || 0);
  const startHour = Number(match[1]);
  const endHour = Number(match[4]);
  if (startHour > 12 || endHour > 12 || startMinute > 59 || endMinute > 59) return null;
  const endMeridiem = meridiemOf(match[6]);
  const endSeconds = clockSeconds(endHour, endMinute, endMeridiem);
  const startMeridiem = match[3] ? meridiemOf(match[3]) : null;
  let seconds = clockSeconds(startHour, startMinute, startMeridiem || endMeridiem);
  if (!startMeridiem && seconds >= endSeconds) {
    seconds = clockSeconds(startHour, startMinute, endMeridiem === "am" ? "pm" : "am");
  }
  if (seconds >= endSeconds) return null;
  return {
    label: source,
    seconds,
    endSeconds,
    booked: /\+\s*$/.test(source),
  };
}

export function clocksFromLabel(text) {
  const slot = parseSlotLabel(text);
  return slot ? [slot.seconds, slot.endSeconds] : [];
}

export function buttonSlots(buttonTexts) {
  const slots = [];
  const seen = new Set();
  for (const raw of buttonTexts) {
    const slot = parseSlotLabel(raw);
    if (!slot) continue;
    const key = `${slot.seconds}:${slot.endSeconds}:${slot.booked}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push(slot);
  }
  return slots;
}

export function labelForSlot(seconds, step, buttonTexts, apiLabel) {
  const end = seconds + step;
  let best = null;
  for (const slot of buttonSlots(buttonTexts)) {
    if (slot.booked || slot.seconds !== seconds || slot.endSeconds !== end) continue;
    if (!best || slot.label.length < best.label.length) best = slot;
  }
  if (best) return { label: best.label, endSeconds: best.endSeconds, booked: false };
  const fallback = String(apiLabel || "").replace(/\s+/g, " ").trim();
  return { label: fallback, endSeconds: end, booked: false };
}

export async function readTimeButtonTexts(page) {
  const nodes = page.locator("button, a, [role='button'], li");
  const count = await nodes.count();
  const texts = [];
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) continue;
    const text = (await node.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (parseSlotLabel(text)) texts.push(text);
  }
  return texts;
}

export async function selectDate(page, date) {
  const hints = dateHints(date);
  const byData = page.locator(`[data-date="${date}"], [data-value="${date}"]`);
  if (await byData.count()) {
    await byData.first().click();
    log("checkout: selected date");
    return;
  }
  const labeled = page.getByRole("button", {
    name: new RegExp(
      `${hints.monthName}\\s+${hints.day}\\b|${hints.weekdayLong}.*\\b${hints.day}\\b|${hints.weekday}.*\\b${hints.day}\\b`,
      "i",
    ),
  });
  if (await labeled.count()) {
    await labeled.first().click();
    log("checkout: selected date");
    return;
  }
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = (await button.innerText()).replace(/\s+/g, " ");
    const hasDay = new RegExp(`\\b${hints.day}\\b`).test(text);
    const folded = text.toLowerCase();
    const hasWeekday = folded.includes(hints.weekday.toLowerCase()) || folded.includes(hints.weekdayLong.toLowerCase());
    const hasMonth = folded.includes(hints.monthName.toLowerCase());
    if (hasDay && (hasWeekday || hasMonth)) {
      await button.click();
      log("checkout: selected date");
      return;
    }
  }
  throw new Error(`Could not select ${date} on the booking page. Nothing was booked.`);
}

export async function selectSurface(page, surface) {
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
  const wanted = parseSlotLabel(label);
  const start = wanted?.seconds ?? seconds;
  const end = wanted?.endSeconds ?? null;
  const wantedText = normalizeText(label);
  const nodes = page.locator("button, a, [role='button'], li");
  const count = await nodes.count();
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) continue;
    const text = normalizeText(await node.innerText().catch(() => ""));
    if (!text || isForbidden(text) || /\+\s*$/.test(text)) continue;
    const slot = parseSlotLabel(text);
    if (!slot || slot.booked || slot.seconds !== start) continue;
    if (end != null && slot.endSeconds !== end) continue;
    const score = wantedText && text === wantedText ? -1 : text.length;
    if (!best || score < best.score) best = { node, text, score };
  }
  if (!best) {
    const shown = label || rangeLabel12(start, end ?? start);
    throw new Error(`Could not find ${shown} on the booking page. Nothing was booked.`);
  }
  await best.node.click();
  log(`checkout: selected time ${best.text || label}`);
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

async function selectTwoUsers(page) {
  const heading = page.getByRole("heading", { name: /^number of /i });
  try {
    await heading.first().waitFor({ state: "visible", timeout: 8000 });
  } catch {
    throw new Error("Could not select 2 users. Nothing was booked.");
  }
  const choice = page.locator("button.ButtonOption", { hasText: /^2$/ });
  const target = await firstVisible(choice);
  if (!target) throw new Error("Could not select 2 users. Nothing was booked.");
  await target.click();
  log("checkout: selected two users");
  await page.waitForTimeout(400);
}

async function openAddUsersSearch(page) {
  const button = page.getByRole("button", { name: /^\s*add users?\s*$/i }).or(page.locator("button.ui.button", { hasText: /^\s*add users?\s*$/i }));
  const target = await firstVisible(button);
  if (!target) throw new Error("Could not find Add users. Nothing was booked.");
  await target.click();
  log("checkout: opened add users");
  try {
    await visibleSearchField(page).first().waitFor({ state: "visible", timeout: 8000 });
  } catch {
    throw new Error("Could not find the add-user search. Nothing was booked.");
  }
}

async function typeAndAddPlayer(page) {
  const field = visibleSearchField(page).first();
  await field.click();
  await field.fill("");
  await field.pressSequentially(SECOND_PLAYER, { delay: 40 });
  const addButton = await addButtonForPlayer(page);
  if (!addButton) {
    throw new Error(`No PlayByPoint user named ${SECOND_PLAYER} was in the player search. Nothing was booked.`);
  }
  await addButton.click();
  if (!(await waitForPlayerOnList(page))) {
    throw new Error(`Could not add ${SECOND_PLAYER} as the second player. Nothing was booked.`);
  }
  log("checkout: added second player");
}

async function clickEnabledNext(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const next = await firstEnabled(page.getByRole("button", { name: /^\s*next\s*$/i }));
    if (next) {
      await next.click();
      log("checkout: continued with Next");
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Could not find Next. Nothing was booked.");
}

async function waitForBookPage(page) {
  const book = page.locator("button.ui.button, div.ui.button").filter({ hasText: /^\s*book\s*$/i });
  try {
    await book.filter({ visible: true }).first().waitFor({ state: "visible", timeout: 15000 });
  } catch {
    throw new Error("The Book page did not open. Nothing was booked.");
  }
  log("checkout: Book page is open");
}

function searchField(page) {
  return page
    .getByPlaceholder(/search for|search|user|player|name or email/i)
    .or(page.getByRole("textbox", { name: /search|add user|user name|player/i }))
    .or(page.getByRole("searchbox"));
}

function visibleSearchField(page) {
  return searchField(page).filter({ visible: true });
}

async function addButtonForPlayer(page) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const buttons = page.getByRole("button", { name: /^add$/i });
    const count = await buttons.count();
    let best = null;
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const near = await button.evaluate((element, name) => {
        let scope = element.parentElement;
        for (let depth = 0; depth < 6 && scope; depth += 1) {
          const text = (scope.innerText || "").replace(/\s+/g, " ");
          if (text.toLowerCase().includes(name.toLowerCase())) return text.length;
          scope = scope.parentElement;
        }
        return null;
      }, SECOND_PLAYER);
      if (near == null) continue;
      if (!best || near < best.near) best = { button, near };
    }
    if (best) return best.button;
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForPlayerOnList(page) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await nameOnPlayerList(page)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function nameOnPlayerList(page) {
  return page.evaluate((name) => {
    const normalized = name.toLowerCase();
    const visible = (node) => node.getClientRects().length > 0;
    const textOf = (node) => (node.innerText || "").replace(/\s+/g, " ").trim();
    const inSearchResult = (node) => {
      let scope = node.parentElement;
      for (let depth = 0; depth < 4 && scope && scope !== document.body; depth += 1) {
        const hasSearch = [...scope.querySelectorAll("input, textarea, [role='searchbox']")].some(visible);
        const hasAdd = [...scope.querySelectorAll("button")].some(
          (button) => visible(button) && /^add$/i.test(textOf(button)),
        );
        if (hasSearch || hasAdd) return true;
        scope = scope.parentElement;
      }
      return false;
    };
    return [...document.querySelectorAll("h1, li, p, span, div, a")].some((node) => {
      if (!visible(node) || inSearchResult(node)) return false;
      if (node.closest(".PlayerSearchList, .PlayerSearchListModal, .ui.modal")) return false;
      if (node.querySelector("input, textarea, [role='searchbox']")) return false;
      const text = textOf(node);
      return text.length <= 120 && text.toLowerCase().includes(normalized);
    });
  }, SECOND_PLAYER);
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function firstEnabled(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const disabled = await item
      .evaluate(
        (element) =>
          element.classList.contains("disabled") ||
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
      )
      .catch(() => true);
    if (!disabled) return item;
  }
  return null;
}

function isForbidden(name) {
  if (/^confirm players$/i.test(name)) return false;
  return /^(book|book now|pay|pay now|confirm|confirm booking|confirm reservation|reserve|place order|complete booking|complete reservation|submit|submit payment)\b/i.test(
    name,
  );
}

function dateHints(date) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  return {
    day: String(day),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(utc),
    weekdayLong: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(utc),
    monthName: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(utc),
  };
}

function meridiemOf(value) {
  return String(value || "").replaceAll(".", "").toLowerCase().startsWith("p") ? "pm" : "am";
}

function clockSeconds(hour, minutes, meridiem) {
  let clock = hour;
  if (meridiem === "pm" && clock < 12) clock += 12;
  if (meridiem === "am" && clock === 12) clock = 0;
  return clock * 3600 + minutes * 60;
}

function rangeLabel12(start, end) {
  return `${clock12(start)} – ${clock12(end)}`;
}

function clock12(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
