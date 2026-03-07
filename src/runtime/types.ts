export interface LLMAdapter {
  complete(prompt: string, input: string): Promise<string>;
}

export class MockLLMAdapter implements LLMAdapter {
  async complete(prompt: string, input: string): Promise<string> {
    console.log("[MockLLM] Prompt length:", prompt.length);
    console.log("[MockLLM] Input:", input.substring(0, 200));
    console.log("[MockLLM] Returning mock output — replace with real LLM adapter");

    // Return a mock IntakeArtifact-shaped response for testing
    return JSON.stringify({
      title: "Mock intake from engine",
      source_ticket: "engine-test-001",
      problem_statement: "This is a mock output from the engine runtime",
      affected_users: "Development team testing the engine pipeline",
      observable_symptom: "No real LLM is configured — this is a placeholder response",
      acceptance_criteria: [
        "Engine successfully loaded the capability",
        "Engine validated input against schema",
        "Engine produced output (mock)"
      ],
      out_of_scope: ["Real LLM integration"],
      assumptions: ["Mock adapter is being used for testing"]
    }, null, 2);
  }
}
