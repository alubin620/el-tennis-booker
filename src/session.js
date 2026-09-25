import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log, attachPageLogging } from "./logger.js";
import { diagnosePage, waitForAppWithLogging } from "./diagnostics.js";
import { STORAGE_PATH } from "./storage-state.js";

const STORAGE = STORAGE_PATH;

export async function openSession(config, { fresh = false } = {}) {
  mkdirSync(dirname(STORAGE), { recursive: true });
  const hasStorage = !fresh && Boolean(await existingStorage());
  log(`openSession: launching chromium headless=${config.headless} reuseStorage=${hasStorage}`);
  const browser = await chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
  });
  const context = await browser.newContext({
    storageState: hasStorage ? STORAGE : undefined,
    viewport: config.headless ? { width: 1280, height: 800 } : null,
    locale: "en-US",
    timezoneId: config.timeZone,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  attachPageLogging(page);
  return {
    browser,
    context,
    page,
    async save() {
      await context.storageState({ path: STORAGE });
      log("session: saved storage state to .auth/storage.json");
    },
    async close() {
      await browser.close();
      log("session: browser closed");
    },
  };
}

async function existingStorage() {
  try {
    const { access } = await import("node:fs/promises");
    await access(STORAGE);
    return STORAGE;
  } catch {
    return undefined;
  }
}

export async function ensureLoggedIn(session, config) {
  const { page } = session;
  log(`ensureLoggedIn: booking url=${config.bookingUrl}`);
  await page.goto(config.bookingUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForAppWithLogging(page);
  await diagnosePage(page, "after-booking-load");

  if (await isLoggedIn(page)) {
    log("ensureLoggedIn: already logged in on booking page");
    await session.save();
    return;
  }
  log("ensureLoggedIn: not logged in, opening sign-in");

  await page.goto(config.signInUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForAppWithLogging(page);
  await diagnosePage(page, "sign-in-form");

  const emailVisible = await page.locator("#user_email").isVisible().catch(() => false);
  log(`ensureLoggedIn: #user_email visible=${emailVisible}`);
  if (!emailVisible) {
    await clearCredentialFields(page);
    await page.screenshot({ path: "sign-in-missing.png", fullPage: true }).catch(() => {});
    throw new Error("Sign-in email field not found. See sign-in-missing.png in the workflow artifacts.");
  }

  await page.locator("#user_email").fill(config.email);
  await page.locator("#user_password").fill(config.password);
  await page.locator("#user_remember_me").check().catch(() => {});
  log("ensureLoggedIn: submitted credentials");
  await page.locator('input[name="commit"]').click();
  await page.waitForLoadState("domcontentloaded", { timeout: 120000 }).catch(() => {});
  await waitForAppWithLogging(page);
  await diagnosePage(page, "after-sign-in-submit");

  await page.goto(config.bookingUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForAppWithLogging(page);
  await diagnosePage(page, "after-login-booking");
  if (!(await isLoggedIn(page))) {
    await clearCredentialFields(page);
    await page.screenshot({ path: "login-failed.png", fullPage: true }).catch(() => {});
    throw new Error("Login failed. Check PBP_EMAIL and PBP_PASSWORD. See login-failed.png artifact.");
  }
  log("ensureLoggedIn: login succeeded");
  await session.save();
}

async function clearCredentialFields(page) {
  await page
    .evaluate(() => {
      for (const id of ["user_email", "user_password"]) {
        const field = document.getElementById(id);
        if (field) field.value = "";
      }
    })
    .catch(() => {});
}

async function isLoggedIn(page) {
  const state = await page.evaluate(() => {
    const node = document.querySelector('[data-react-class="BookBox"]');
    if (!node) {
      return { loggedIn: !location.pathname.includes("sign_in"), userId: null, hasBookBox: false };
    }
    try {
      const props = JSON.parse(node.getAttribute("data-react-props") || "{}");
      const userId = props.current_user?.id ?? 0;
      return { loggedIn: Boolean(userId), userId, hasBookBox: true };
    } catch {
      return { loggedIn: false, userId: null, hasBookBox: true };
    }
  });
  log(`isLoggedIn: ${JSON.stringify(state)}`);
  return state.loggedIn;
}

export async function readFacility(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-react-class="BookBox"]');
    if (!node) return null;
    const props = JSON.parse(node.getAttribute("data-react-props") || "{}");
    return {
      facilityId: props.facility_id,
      timeZone: props.timeZone,
      userId: props.current_user?.id || 0,
      userName: props.current_user?.name || "",
      maxHoursAhead: props.amount_of_max_hours_prior_to_book,
      nextOpenScheduleDateTime: props.nextOpenScheduleDateTime,
      timeStep: props.time_step || 1800,
      allowCourtSelection: props.allow_court_selection,
      autoFillCourts: Boolean(props.autoAssingCourtsRule),
      allowPayOnline: props.allow_pay_online,
      allowPrepaid: props.allow_prepaid,
      playersDefault: props.initialPlayerQuantitySelected,
    };
  });
}
