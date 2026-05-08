import { z } from "zod";

const PlanStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string().min(1),
  surface: z.enum([
    "web_ui", "mobile_ui", "api_endpoint", "background_job",
    "report", "admin_tool", "not_applicable", "unknown",
  ]),
  executionContext: z.enum([
    "frontend", "backend", "database", "external_service", "infra", "not_applicable", "unknown",
  ]),
  stackAssumption: z.enum([
    "none", "react", "next", "react_native", "expo", "python", "mixed", "not_applicable", "unknown",
  ]),
  description: z.string().min(1),
  dependencies: z.array(z.number().int()).optional(),
  acceptanceCriteria: z.string().min(1),
});

export const PlanArtifactSchema = z.object({
  sourceTicket: z.string().min(1),
  designTitle: z.string().min(1),
  status: z.enum(["actionable", "blocked"]),

  // Present when status is "blocked"
  blockedReason: z.string().optional(),
  unresolvedQuestions: z.array(z.object({
    question: z.string().min(1),
    owner: z.string().min(1),
  })).optional(),

  // Present when status is "actionable"
  changeStrategy: z.string().optional(),
  risks: z.array(z.object({
    risk: z.string().min(1),
    trigger: z.string().min(1),
  })).optional(),
  validationPlan: z.array(z.object({
    ac: z.string().min(1),
    verification: z.string().min(1),
  })).optional(),
  steps: z.array(PlanStepSchema).optional(),
}).refine(
  (data) => {
    if (data.status === "blocked") {
      return !!data.blockedReason && !!data.unresolvedQuestions && data.unresolvedQuestions.length > 0;
    }
    if (data.status === "actionable") {
      return !!data.changeStrategy && !!data.risks && data.risks.length > 0
        && !!data.validationPlan && data.validationPlan.length > 0
        && !!data.steps && data.steps.length > 0;
    }
    return false;
  },
  {
    message: "Blocked plans require blockedReason + unresolvedQuestions. Actionable plans require changeStrategy + risks + validationPlan + steps.",
  }
);

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;
