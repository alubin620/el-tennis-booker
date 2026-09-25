export const CLOUDFLARE_INTERACTIVE_HELP =
  "Cloudflare is showing a checkbox a headless browser cannot click. On the same home network, open the booking page in a normal browser, then copy the site cookies into the container auth folder.";

export async function detectInteractiveChallenge(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    const lower = text.toLowerCase();
    const iframeChallenge = Boolean(
      document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'),
    );
    const widget = Boolean(
      document.querySelector(
        '.cf-turnstile, #cf-turnstile, [data-sitekey], input[name="cf-turnstile-response"]',
      ),
    );
    const humanText =
      lower.includes("verify you are human") || lower.includes("confirm you are human");
    const titleChallenge = (document.title || "").toLowerCase().includes("just a moment");
    return {
      active: iframeChallenge || widget || humanText,
      iframeChallenge,
      widget,
      humanText,
      titleChallenge,
      snippet: text.slice(0, 280),
    };
  });
}

export async function assertNoInteractiveChallenge(page, label) {
  const check = await detectInteractiveChallenge(page);
  if (!check.active) return check;
  await page.screenshot({ path: "challenge.png", fullPage: true }).catch(() => {});
  const err = new Error(
    `Cloudflare interactive challenge at ${label}. ${CLOUDFLARE_INTERACTIVE_HELP}\nSignals: ${JSON.stringify(check)}`,
  );
  err.code = "CLOUDFLARE_INTERACTIVE";
  throw err;
}
