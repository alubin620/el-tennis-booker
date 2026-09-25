import { bookingUrlFromInput, openSlots } from "../src/lookup.js";
import { openSession } from "../src/session.js";

const slots = openSlots(
  [
    { seconds: 32400, available: true, label: "9:00 AM" },
    { seconds: 34200, available: true, label: "9:30 AM" },
    { seconds: 36000, available: false, label: "10:00 AM" },
  ],
  1800,
);
if (slots.length !== 2 || slots[0].label !== "9:00 AM" || slots[1].seconds !== 34200) {
  throw new Error("open times were merged or dropped");
}

const mapped = openSlots([{ seconds: 57600, available: true, label: "16:00" }], 3600, ["4:00 PM – 5:00 PM"]);
if (mapped.length !== 1 || mapped[0].label !== "4:00 PM – 5:00 PM" || mapped[0].seconds !== 57600) {
  throw new Error("booking page label was replaced");
}

const url = bookingUrlFromInput("https://app.playbypoint.com/book/example");
if (!url.endsWith("/book/example")) {
  throw new Error(`Unexpected booking URL: ${url}`);
}

try {
  const session = await openSession({ headless: true, timeZone: "UTC" }, { fresh: true });
  await session.close();
} catch (error) {
  if (error instanceof ReferenceError) throw error;
  const message = String(error?.message || error);
  if (!/executable doesn't exist|browserType\.launch|please run the following/i.test(message)) {
    throw error;
  }
  console.log("smoke: startup reached Chromium launch");
}
