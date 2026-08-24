// Types mirroring Forge OS ApiModels.kt / ForgeHttpServer responses.

export interface ParameterProperty {
  type: string;
  description: string;
  enum?: string[] | null;
}

export interface FunctionParameters {
  type: string;
  properties: Record<string, ParameterProperty>;
  required: string[];
}

export interface ToolDefinition {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: FunctionParameters;
  };
}

export interface ConnectionConfig {
  host: string;
  port: number;
  token: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
}

// Re-export ConnectionProfile from connectionManager
export type { ConnectionProfile } from "./connectionManager";
