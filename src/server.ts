/**
 * tpdc-engine HTTP server — exposes the Inngest endpoint.
 *
 * Inngest discovers workflow functions via this endpoint when its
 * dev server (or production runner) introspects the app. We use Hono
 * because Inngest ships a first-class adapter (`inngest/hono`).
 *
 * Run dev mode:
 *   npm run dev                 # this server (tsx watch)
 *   npm run inngest:dev         # Inngest dev server in another terminal
 *
 * The Inngest dev server polls `http://localhost:3000/api/inngest`
 * by default. Adjust via PORT env var.
 */

import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve as nodeServe } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";

import { inngest } from "./inngest/client.js";
import { shipFeature } from "./inngest/workflows/ship-feature.js";
import { VERSION } from "./index.js";

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

export default app;

// Start server when run directly (not when imported by tests/etc.)
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  nodeServe({ fetch: app.fetch, port }, (info) => {
    console.log(`tpdc-engine v${VERSION} listening on http://localhost:${info.port}`);
    console.log(`  GET /             health`);
    console.log(`  /api/inngest      Inngest webhook`);
    console.log(``);
    console.log(`Run \`npm run inngest:dev\` in another terminal to start the`);
    console.log(`Inngest dev server (it discovers functions via /api/inngest).`);
  });
}
