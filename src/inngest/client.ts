/**
 * Inngest client — TPDC v2 workflow engine entry.
 *
 * The workflow engine is Inngest (per DECISIONS.md §D1).
 * State persistence, retries, and hibernation are handled by Inngest.
 *
 * Note on event typing: Inngest's `fromZod` expects Zod v3's runtime shape;
 * Zod v4 changed it. We type events via TypeScript here and validate
 * payloads at runtime via the Zod schemas in `../schemas/events.ts`
 * (called explicitly at HTTP/CLI/MCP entry points).
 */

import { EventSchemas, Inngest } from "inngest";
import type {
  CiCompleted,
  ExecuteToolCall,
  FeatureRequested,
  IntakeUnblockRequested,
  IntakeUnblocked,
  PlanUnblockRequested,
  PlanUnblocked,
  TeamMeetingCompleted,
} from "../schemas/events.js";

export type TpdcEvents = {
  "tpdc/feature.requested": { data: FeatureRequested };
  "tpdc/ci.completed": { data: CiCompleted };
  "tpdc/intake.unblock_requested": { data: IntakeUnblockRequested };
  "tpdc/intake.unblocked": { data: IntakeUnblocked };
  "tpdc/plan.unblock_requested": { data: PlanUnblockRequested };
  "tpdc/plan.unblocked": { data: PlanUnblocked };
  "tpdc/execute.tool_call": { data: ExecuteToolCall };
  "tpdc/team-meeting.completed": { data: TeamMeetingCompleted };
};

export const inngest = new Inngest({
  id: "tpdc-engine",
  schemas: new EventSchemas().fromRecord<TpdcEvents>(),
});
