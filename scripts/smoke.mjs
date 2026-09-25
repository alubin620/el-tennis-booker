import { bookingUrlFromInput } from "../src/lookup.js";
import { openSession } from "../src/session.js";

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
