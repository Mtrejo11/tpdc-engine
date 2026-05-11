/**
 * tpdc unblock — answer pending intake questions and resume a halted workflow.
 *
 * Usage:
 *   tpdc unblock <runId> --answers <path-to-json> [--stage intake]
 *
 * The answers JSON is an array of { question, answer } objects. The user
 * reads the questions from the Inngest dev server UI (where the
 * `tpdc/intake.unblock_requested` event is visible) and writes the answers
 * to a file.
 *
 * This command sends `tpdc/intake.unblocked` to the Inngest dev server's
 * event endpoint, which wakes up the hibernating workflow.
 *
 * Env vars:
 *   INNGEST_BASE_URL   default http://localhost:8288
 *   INNGEST_EVENT_KEY  default "test-key" (matches dev server defaults)
 */

import * as fs from "node:fs/promises";
import {
  IntakeUnblockedSchema,
  PlanResolutionSchema,
  PlanUnblockedSchema,
  UnblockAnswerSchema,
} from "../schemas/events.js";
import { z } from "zod";

const DEFAULT_INNGEST_BASE = "http://localhost:8288";
const DEFAULT_EVENT_KEY = "test-key";

const IntakeAnswersFileSchema = z.array(UnblockAnswerSchema).min(1);
const PlanResolutionsFileSchema = z.array(PlanResolutionSchema).min(1);

export async function runUnblock(args: string[]): Promise<void> {
  const [runId, ...rest] = args;

  if (!runId || runId.startsWith("--")) {
    printUsage();
    process.exit(2);
  }

  let answersPath: string | null = null;
  let stage: "intake" | "plan" = "intake";

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--answers") {
      const next = rest[++i];
      if (!next) {
        console.error("error: --answers requires a path");
        process.exit(2);
      }
      answersPath = next;
    } else if (flag === "--stage") {
      const next = rest[++i];
      if (next !== "intake" && next !== "plan") {
        console.error(`error: --stage must be "intake" or "plan"`);
        process.exit(2);
      }
      stage = next;
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`error: unknown flag "${flag}"`);
      printUsage();
      process.exit(2);
    }
  }

  if (!answersPath) {
    console.error("error: --answers <path-to-json> is required");
    printUsage();
    process.exit(2);
  }

  let raw: string;
  try {
    raw = await fs.readFile(answersPath, "utf-8");
  } catch (err) {
    console.error(`error: could not read ${answersPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    console.error(`error: ${answersPath} is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  // Build payload — shape depends on stage
  let eventName: string;
  let eventPayload: unknown;
  let countLabel: string;
  let count: number;

  if (stage === "intake") {
    const validation = IntakeAnswersFileSchema.safeParse(parsedJson);
    if (!validation.success) {
      console.error(`error: ${answersPath} does not match the expected shape.`);
      console.error("Expected: an array of { question: string, answer: string }");
      console.error(`Issues:`);
      for (const issue of validation.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    const answers = validation.data;
    eventPayload = IntakeUnblockedSchema.parse({ runId, answers });
    eventName = "tpdc/intake.unblocked";
    countLabel = "answer";
    count = answers.length;
  } else {
    const validation = PlanResolutionsFileSchema.safeParse(parsedJson);
    if (!validation.success) {
      console.error(`error: ${answersPath} does not match the expected shape.`);
      console.error("Expected: an array of { blocker: string, resolution: string }");
      console.error(`Issues:`);
      for (const issue of validation.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    const resolutions = validation.data;
    eventPayload = PlanUnblockedSchema.parse({ runId, resolutions });
    eventName = "tpdc/plan.unblocked";
    countLabel = "resolution";
    count = resolutions.length;
  }

  const baseUrl = process.env.INNGEST_BASE_URL ?? DEFAULT_INNGEST_BASE;
  const eventKey = process.env.INNGEST_EVENT_KEY ?? DEFAULT_EVENT_KEY;
  const url = `${baseUrl}/e/${eventKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: eventName,
        data: eventPayload,
      }),
    });
  } catch (err) {
    console.error(
      `error: could not reach Inngest at ${url}: ${(err as Error).message}`,
    );
    console.error(
      `hint: is the Inngest dev server running? (\`npm run inngest:dev\`)`,
    );
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "<no body>");
    console.error(
      `error: Inngest returned ${response.status} ${response.statusText}`,
    );
    console.error(body);
    process.exit(1);
  }

  console.log(
    `Sent ${eventName} for runId=${runId} with ${count} ${countLabel}${count === 1 ? "" : "s"}.`,
  );
  console.log(`Watch the workflow resume at ${baseUrl}.`);
}

function printUsage(): void {
  console.log(
    [
      `Usage: tpdc unblock <runId> --answers <path-to-json> [--stage intake|plan]`,
      ``,
      `Sends a tpdc/<stage>.unblocked event to the Inngest dev server,`,
      `waking up a workflow that hibernated at the unblock gate.`,
      ``,
      `Required:`,
      `  <runId>                    The runId of the halted workflow`,
      `  --answers <path>           JSON file (shape depends on --stage)`,
      ``,
      `Optional:`,
      `  --stage intake|plan        Default "intake".`,
      ``,
      `Answers file shape:`,
      `  --stage intake: [{ question, answer }, ...]`,
      `  --stage plan:   [{ blocker, resolution }, ...]`,
      ``,
      `Env vars:`,
      `  INNGEST_BASE_URL           default http://localhost:8288`,
      `  INNGEST_EVENT_KEY          default "test-key"`,
      ``,
      `Example intake answers.json:`,
      `  [`,
      `    { "question": "Which platforms?", "answer": "Web only" },`,
      `    { "question": "Token expiry?", "answer": "30 minutes" }`,
      `  ]`,
      ``,
      `Example plan resolutions.json:`,
      `  [`,
      `    { "blocker": "Frontend framework not specified", "resolution": "React" },`,
      `    { "blocker": "Auth method unclear", "resolution": "Existing JWT in src/auth/" }`,
      `  ]`,
    ].join("\n"),
  );
}
