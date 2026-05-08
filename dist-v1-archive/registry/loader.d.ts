import { CapabilityDefinition } from "../protocols";
export declare function listInstalledCapabilities(): CapabilityDefinition[];
export declare function loadCapability(id: string, version?: string): {
    definition: CapabilityDefinition;
    prompt: string;
    inputSchema: object;
    outputSchema: object;
    basePath: string;
} | null;
