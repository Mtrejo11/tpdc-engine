/**
 * tpdc-engine HTTP server — exposes the Inngest endpoint and the
 * GitHub webhook receiver.
 *
 * Inngest discovers workflow functions via /api/inngest when its dev
 * server (or production runner) introspects the app. The GitHub webhook
 * route receives check_suite.completed events and emits tpdc/ci.completed
 * back to Inngest so workflows can wake from waitForEvent hibernation.
 *
 * Run dev mode:
 *   npm run dev                 # this server (tsx watch)
 *   npm run inngest:dev         # Inngest dev server in another terminal
 *
 * For the GitHub webhook in dev, expose this server with ngrok or
 * cloudflared and point the repo's webhook at the tunnel URL. Set
 * GITHUB_WEBHOOK_SECRET to match the secret configured in the repo.
 */

import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve as nodeServe } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";

import { inngest } from "./inngest/client.js";
import { shipFeature } from "./inngest/workflows/ship-feature.js";
import { VERSION } from "./index.js";
import {
  parseCheckSuitePayload,
  verifyGitHubSignature,
} from "./server/github-webhook.js";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "tpdc-engine",
    version: VERSION,
    status: "alive",
  }),
);

app.on(
  ["GET", "POST", "PUT"],
  "/api/inngest",
  inngestServe({
    client: inngest,
    functions: [shipFeature],
  }),
);

/**
 * GitHub webhook receiver. Validates HMAC, parses check_suite events,
 * emits tpdc/ci.completed to Inngest. Returns 200 even on "ignored"
 * outcomes so GitHub's delivery dashboard stays clean.
 */
app.post("/api/github/webhook", async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // Failing closed: refuse to process if the secret isn't configured.
    return c.json({ ok: false, error: "GITHUB_WEBHOOK_SECRET not set" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    return c.json({ ok: false, error: "invalid signature" }, 401);
  }

  // Only process check_suite events; ignore everything else cleanly.
  const eventType = c.req.header("x-github-event") ?? "";
  if (eventType !== "check_suite") {
    return c.json({ ok: true, ignored: `event=${eventType}` });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: "malformed JSON" }, 400);
  }

  const outcome = parseCheckSuitePayload(payload as Parameters<typeof parseCheckSuitePayload>[0]);
  if (outcome.kind === "ignored") {
    return c.json({ ok: true, ignored: outcome.reason });
  }

  try {
    await inngest.send(outcome.event);
  } catch (err) {
    return c.json(
      { ok: false, error: `inngest.send failed: ${(err as Error).message}` },
      502,
    );
  }

  return c.json({
    ok: true,
    emitted: outcome.event.name,
    runId: outcome.event.data.runId,
    status: outcome.event.data.status,
  });
});

export default app;

// Start server when run directly (not when imported by tests/etc.)
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  nodeServe({ fetch: app.fetch, port }, (info) => {
    console.log(`tpdc-engine v${VERSION} listening on http://localhost:${info.port}`);
    console.log(`  GET  /                    health`);
    console.log(`  ANY  /api/inngest         Inngest webhook`);
    console.log(`  POST /api/github/webhook  GitHub check_suite events`);
    console.log(``);
    console.log(`Run \`npm run inngest:dev\` in another terminal to start the`);
    console.log(`Inngest dev server (it discovers functions via /api/inngest).`);
    if (!process.env.GITHUB_WEBHOOK_SECRET) {
      console.warn(
        `\n⚠️  GITHUB_WEBHOOK_SECRET not set — /api/github/webhook will reject all incoming requests.`,
      );
    }
  });
}
