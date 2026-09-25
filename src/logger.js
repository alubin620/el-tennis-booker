const VERBOSE = process.env.PBP_VERBOSE !== "0";

export function log(message) {
  console.log(`[${stamp()}] ${message}`);
}

export function logSection(title) {
  console.log(`\n[${stamp()}] ========== ${title} ==========`);
}

export function logJson(label, value, maxLen = 4000) {
  let text;
  try {
    text = JSON.stringify(value, replacer, 2);
  } catch (error) {
    text = String(value);
  }
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}\n... (truncated ${text.length - maxLen} chars)`;
  }
  console.log(`[${stamp()}] ${label}:\n${text}`);
}

export function logEnv() {
  logSection("Environment");
  log(`node=${process.version}`);
  log(`platform=${process.platform} arch=${process.arch}`);
  log(`cwd=${process.cwd()}`);
  log(`HEADLESS=${process.env.HEADLESS ?? "(unset)"}`);
  log(`PBP_VERBOSE=${process.env.PBP_VERBOSE ?? "(unset, default on)"}`);
  log(`CI=${process.env.GITHUB_ACTIONS === "true" ? "true" : process.env.CI ?? "false"}`);
  log(`runner=${process.env.RUNNER_OS ?? "local"} ${process.env.RUNNER_NAME ?? ""}`.trim());
  log(`workflow=${process.env.GITHUB_WORKFLOW ?? "local"} job=${process.env.GITHUB_JOB ?? ""}`);
  log(`run_id=${process.env.GITHUB_RUN_ID ?? ""} attempt=${process.env.GITHUB_RUN_ATTEMPT ?? ""}`);
  log(`PBP_EMAIL set=${Boolean(process.env.PBP_EMAIL)}`);
  log(`PBP_PASSWORD set=${Boolean(process.env.PBP_PASSWORD)}`);
}

export function logError(error, extra = "") {
  logSection("Error");
  if (extra) log(extra);
  log(`message=${error?.message ?? error}`);
  if (error?.stack) console.error(error.stack);
}

export function summarizeBody(body) {
  if (body == null) return "null";
  if (typeof body === "string") return body.slice(0, 500);
  if (Array.isArray(body)) return `array(len=${body.length}) preview=${JSON.stringify(body.slice(0, 2)).slice(0, 300)}`;
  if (typeof body === "object") {
    const keys = Object.keys(body);
    const preview = {};
    for (const key of keys.slice(0, 12)) preview[key] = body[key];
    return `object keys=[${keys.join(", ")}] preview=${JSON.stringify(preview).slice(0, 500)}`;
  }
  return String(body);
}

function stamp() {
  return new Date().toISOString();
}

function replacer(_key, value) {
  if (typeof value === "string" && value.length > 800) {
    return `${value.slice(0, 800)}…`;
  }
  return value;
}

export function attachPageLogging(page) {
  if (!VERBOSE) return;

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      log(`browser.console.${type}: ${msg.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    log(`browser.pageerror: ${error.message}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isInterestingUrl(url)) return;
    log(`browser.requestfailed: ${request.method()} ${url} failure=${request.failure()?.errorText ?? "unknown"}`);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!isInterestingUrl(url)) return;
    const status = response.status();
    if (status >= 400 || url.includes("/api/") || url.includes("challenge")) {
      log(`browser.response: ${status} ${response.request().method()} ${shortUrl(url)}`);
    }
  });
}

function isInterestingUrl(url) {
  return (
    url.includes("playbypoint.com") ||
    url.includes("cloudflare") ||
    url.includes("challenges.cloudflare.com")
  );
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.search ? parsed.search.slice(0, 80) : ""}`;
  } catch {
    return url.slice(0, 120);
  }
}
