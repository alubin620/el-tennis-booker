import { createServer, request as httpRequest } from "node:http";
import { bookingUrlFromInput, lookupAvailability } from "./lookup.js";

const NOVNC_PORT = 6080;

const port = Number(process.env.SETTINGS_PORT || 8890);
let busy = false;

const server = createServer(async (req, res) => {
  try {
    const path = pathname(req.url);
    if (path === "/live-view" || path === "/live-view/") {
      res.writeHead(302, {
        Location: "/live-view/vnc.html?autoconnect=1&resize=scale&path=live-view/websockify",
      });
      res.end();
      return;
    }
    if (path.startsWith("/live-view/")) return proxyNovnc(req, res);
    if (req.method === "GET" && (path === "/" || path === "/settings" || path === "/settings/")) {
      return send(res, 200, page("", "", null));
    }
    if (req.method !== "POST" || (path !== "/" && path !== "/settings")) return send(res, 404, "Not found");

    const body = JSON.parse(await readBody(req));
    const bookingUrl = bookingUrlFromInput(body.bookingUrl);
    if (busy) return send(res, 200, page(bookingUrl, "Already checking a booking page. Wait for it to finish.", null));
    busy = true;
    try {
      const result = await lookupAvailability(bookingUrl);
      return send(res, 200, page(bookingUrl, "", result));
    } finally {
      busy = false;
    }
  } catch (error) {
    busy = false;
    const bookingUrl = "";
    send(res, 200, page(bookingUrl, error.message, null));
  }
});

server.on("upgrade", (req, socket, head) => {
  if (!pathname(req.url).startsWith("/live-view/")) {
    socket.destroy();
    return;
  }
  const proxy = httpRequest({
    hostname: "127.0.0.1",
    port: NOVNC_PORT,
    path: stripLivePrefix(req.url),
    method: "GET",
    headers: { ...req.headers, host: `127.0.0.1:${NOVNC_PORT}` },
  });
  proxy.on("upgrade", (upstream, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${upstream.statusCode} ${upstream.statusMessage}`];
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead?.length) socket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  proxy.on("error", () => socket.destroy());
  proxy.end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Settings page listening on ${port}`);
});

function pathname(url) {
  return new URL(url || "/", "http://localhost").pathname;
}

function stripLivePrefix(url) {
  const parsed = new URL(url || "/", "http://localhost");
  let path = parsed.pathname.replace(/^\/live-view/, "") || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return `${path}${parsed.search}`;
}

function proxyNovnc(req, res) {
  const proxy = httpRequest(
    {
      hostname: "127.0.0.1",
      port: NOVNC_PORT,
      path: stripLivePrefix(req.url),
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${NOVNC_PORT}` },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) send(res, 502, "Live view is not up yet. Restart the container and try again.");
  });
  req.pipe(proxy);
}

function page(bookingUrl, message, result) {
  const banner = message ? `<p class="banner">${escapeHtml(message)}</p>` : "";
  const times = result ? renderTimes(result) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Available courts</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; color: #1a1a1a; }
    label { display: block; margin: 0.8rem 0 0.25rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.55rem 0.6rem; }
    button { margin-top: 0.8rem; padding: 0.55rem 0.9rem; }
    .banner { background: #f4f4f4; padding: 0.7rem 0.8rem; }
    .day { margin-top: 1.2rem; }
    .surface { margin: 0.3rem 0 0.6rem; }
  </style>
</head>
<body>
  <h1>Available courts</h1>
  <p>Paste a PlayByPoint booking link. The container uses the email and password already set in its environment.</p>
  <p>If Cloudflare asks you to click a box, open <a href="/live-view">the live view</a> in another tab and click it there. Login cookies stay in the auth folder afterward.</p>
  ${banner}
  <form id="lookup">
    <label for="bookingUrl">Booking link</label>
    <input id="bookingUrl" name="bookingUrl" value="${escapeHtml(bookingUrl)}" placeholder="https://app.playbypoint.com/book/yourclub" required>
    <button type="submit" id="go">Show available times</button>
  </form>
  ${times}
  <script>
    document.getElementById("lookup").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("go");
      button.disabled = true;
      button.textContent = "Signing in…";
      const response = await fetch(location.pathname || "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingUrl: event.currentTarget.bookingUrl.value }),
      });
      document.open();
      document.write(await response.text());
      document.close();
    });
  </script>
</body>
</html>`;
}

function renderTimes(result) {
  const days = result.days
    .map((day) => {
      const surfaces = day.surfaces
        .map((surface) => {
          const text = surface.ranges.length ? surface.ranges.join(", ") : "none open";
          return `<p class="surface"><strong>${escapeHtml(surface.surface)}</strong> — ${escapeHtml(text)}</p>`;
        })
        .join("");
      return `<section class="day"><h2>${escapeHtml(day.weekday)} ${escapeHtml(day.date)}</h2>${surfaces}</section>`;
    })
    .join("");
  const next = result.nextOpen ? `<p>Next booking window opens ${escapeHtml(result.nextOpen)}.</p>` : "";
  return `<h2>Open times</h2><p>Facility ${escapeHtml(result.facilityId)}. Times are ${escapeHtml(result.timeZone)}.</p>${next}${days}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function send(res, status, body) {
  const html = String(body).startsWith("<!");
  res.writeHead(status, { "Content-Type": html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
