import { z } from "zod";
declare const PlanStepSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    title: z.ZodString;
    goal: z.ZodString;
    surface: z.ZodEnum<{
        unknown: "unknown";
        web_ui: "web_ui";
        mobile_ui: "mobile_ui";
        api_endpoint: "api_endpoint";
        background_job: "background_job";
        report: "report";
        admin_tool: "admin_tool";
        not_applicable: "not_applicable";
    }>;
    executionContext: z.ZodEnum<{
        unknown: "unknown";
        not_applicable: "not_applicable";
        frontend: "frontend";
        backend: "backend";
        database: "database";
        external_service: "external_service";
        infra: "infra";
    }>;
    stackAssumption: z.ZodEnum<{
        unknown: "unknown";
        not_applicable: "not_applicable";
        none: "none";
        react: "react";
        next: "next";
        react_native: "react_native";
        expo: "expo";
        python: "python";
        mixed: "mixed";
    }>;
    description: z.ZodString;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    acceptanceCriteria: z.ZodString;
}, z.core.$strip>;
export declare const PlanArtifactSchema: z.ZodObject<{
    sourceTicket: z.ZodString;
    designTitle: z.ZodString;
    status: z.ZodEnum<{
        actionable: "actionable";
        blocked: "blocked";
    }>;
    blockedReason: z.ZodOptional<z.ZodString>;
    unresolvedQuestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        owner: z.ZodString;
    }, z.core.$strip>>>;
    changeStrategy: z.ZodOptional<z.ZodString>;
    risks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        risk: z.ZodString;
        trigger: z.ZodString;
    }, z.core.$strip>>>;
    validationPlan: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ac: z.ZodString;
        verification: z.ZodString;
    }, z.core.$strip>>>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        stepNumber: z.ZodNumber;
        title: z.ZodString;
        goal: z.ZodString;
        surface: z.ZodEnum<{
            unknown: "unknown";
            web_ui: "web_ui";
            mobile_ui: "mobile_ui";
            api_endpoint: "api_endpoint";
            background_job: "background_job";
            report: "report";
            admin_tool: "admin_tool";
            not_applicable: "not_applicable";
        }>;
        executionContext: z.ZodEnum<{
            unknown: "unknown";
            not_applicable: "not_applicable";
            frontend: "frontend";
            backend: "backend";
            database: "database";
            external_service: "external_service";
            infra: "infra";
        }>;
        stackAssumption: z.ZodEnum<{
            unknown: "unknown";
            not_applicable: "not_applicable";
            none: "none";
            react: "react";
            next: "next";
            react_native: "react_native";
            expo: "expo";
            python: "python";
            mixed: "mixed";
        }>;
        description: z.ZodString;
        dependencies: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        acceptanceCriteria: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;
export {};
