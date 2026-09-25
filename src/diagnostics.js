import { log, logJson } from "./logger.js";
import { assertNoInteractiveChallenge } from "./challenge.js";

export async function diagnosePage(page, label = "page") {
  const snapshot = await page.evaluate(() => {
    const title = document.title || "";
    const href = location.href;
    const html = document.documentElement?.outerHTML || "";
    const lower = html.toLowerCase();
    const bookBox = document.querySelector('[data-react-class="BookBox"]');
    let bookBoxUserId = null;
    let facilityId = null;
    if (bookBox) {
      try {
        const props = JSON.parse(bookBox.getAttribute("data-react-props") || "{}");
        bookBoxUserId = props.current_user?.id ?? 0;
        facilityId = props.facility_id ?? null;
      } catch {
        bookBoxUserId = "parse_error";
      }
    }
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    const bodyLower = text.toLowerCase();
    const checkbox =
      Boolean(
        document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'),
      ) || Boolean(document.querySelector(".cf-turnstile, #cf-turnstile, [data-sitekey]"));
    const verifyHuman =
      bodyLower.includes("verify you are human") || bodyLower.includes("confirm you are human");
    return {
      href,
      title,
      readyState: document.readyState,
      pathname: location.pathname,
      hasBookBox: Boolean(bookBox),
      bookBoxUserId,
      facilityId,
      hasSignInEmail: Boolean(document.querySelector("#user_email")),
      hasSignInPassword: Boolean(document.querySelector("#user_password")),
      hasLoginButton: Boolean(document.querySelector('input[name="commit"]')),
      csrfTokenPresent: Boolean(csrf),
      csrfTokenPrefix: csrf ? csrf.slice(0, 8) : "",
      cloudflare: {
        titleJustAMoment: title.toLowerCase().includes("just a moment"),
        hasChallengeScript: lower.includes("challenge-platform") || lower.includes("/cdn-cgi/challenge"),
        hasCfChlOpt: lower.includes("_cf_chl_opt"),
        hasTurnstile: lower.includes("challenges.cloudflare.com"),
        bodySnippet: text.trim().slice(0, 400),
        interactiveChallenge: checkbox || verifyHuman,
        humanTextHint:
          bodyLower.includes("verify you are human") ||
          bodyLower.includes("not a bot") ||
          bodyLower.includes("checking your browser"),
      },
      scripts: [...document.scripts]
        .map((s) => s.src)
        .filter(Boolean)
        .slice(0, 15),
      reactMounts: [...document.querySelectorAll("[data-react-class]")]
        .map((n) => n.getAttribute("data-react-class"))
        .slice(0, 10),
    };
  });

  log(`diagnostics.${label}: url=${snapshot.href}`);
  log(`diagnostics.${label}: title="${snapshot.title}" readyState=${snapshot.readyState}`);
  logJson(`diagnostics.${label}`, snapshot);
  return snapshot;
}

export async function waitForAppWithLogging(page, { timeoutMs = 90000, pollMs = 5000 } = {}) {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    const snap = await diagnosePage(page, `wait#${attempt}`);
    if (snap.cloudflare.interactiveChallenge) {
      await assertNoInteractiveChallenge(page, `wait#${attempt}`);
    }
    const challengePage = snap.cloudflare.titleJustAMoment;
    const appShell =
      snap.hasBookBox ||
      snap.hasSignInEmail ||
      snap.pathname.includes("/users/sign_in") ||
      /^Book for /i.test(snap.title);
    if (!challengePage && appShell) {
      log(
        `waitForApp: ready after ${Date.now() - started}ms (attempt ${attempt}) challengeScript=${snap.cloudflare.hasChallengeScript}`,
      );
      return snap;
    }
    log(
      `waitForApp: still waiting (${Date.now() - started}ms) challengePage=${challengePage} appShell=${appShell} bookBox=${snap.hasBookBox} signIn=${snap.hasSignInEmail}`,
    );
    await page.waitForTimeout(Math.min(pollMs, timeoutMs - (Date.now() - started)));
  }
  await page.screenshot({ path: "challenge.png", fullPage: true }).catch(() => {});
  const final = await diagnosePage(page, "timeout");
  throw new Error(
    `PlayByPoint did not finish loading within ${timeoutMs}ms. title="${final.title}" cloudflare=${JSON.stringify(final.cloudflare)}`,
  );
}
