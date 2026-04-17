const backendUrl = (process.env.BACKEND_URL || "").trim();
const cronToken = (process.env.INTERNAL_CRON_TOKEN || "").trim();

if (!backendUrl) {
  throw new Error("BACKEND_URL is not configured");
}

if (!cronToken) {
  throw new Error("INTERNAL_CRON_TOKEN is not configured");
}

const triggerUrl = new URL("/api/status/run-payment-parser", backendUrl).toString();

const response = await fetch(triggerUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cronToken}`,
    "Content-Type": "application/json",
  },
});

const bodyText = await response.text();
if (!response.ok) {
  throw new Error(`Parser trigger failed (${response.status}): ${bodyText}`);
}

console.log(`Parser trigger success: ${bodyText}`);
