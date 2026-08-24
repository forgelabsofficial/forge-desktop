import { z } from "zod";
import { listTools } from "./api";
import type { ConnectionConfig, ParameterProperty, ToolDefinition } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface CachedTool {
  definition: ToolDefinition;
  schema: z.ZodTypeAny;
}

/**
 * ToolValidator (Task 7, Requirements 11.1-11.5):
 * - Fetches and caches tool definitions from the device (5-minute TTL).
 * - Validates tool arguments against the device's JSON Schema using Zod.
 * - Generates TypeScript type definitions from schemas.
 */
export class ToolValidator {
  private cache = new Map<string, CachedTool>();
  private lastFetch = 0;
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(private cfg: ConnectionConfig) {}

  /** Fetch tool definitions and refresh the cache. */
  async load(): Promise<ToolDefinition[]> {
    const defs = await listTools(this.cfg);
    this.cache.clear();
    for (const def of defs) {
      this.cache.set(def.function.name, {
        definition: def,
        schema: buildZodSchema(def.function.parameters),
      });
    }
    this.lastFetch = Date.now();
    return defs;
  }

  /** Load definitions if the cache is empty or stale. */
  async ensureFresh(): Promise<void> {
    if (this.cache.size === 0 || Date.now() - this.lastFetch > this.cacheTtlMs) {
      await this.load();
    }
  }

  /** Validate arguments for a tool (required params, types, enums). */
  async validate(name: string, args: Record<string, unknown>): Promise<ValidationResult> {
    await this.ensureFresh();
    const entry = this.cache.get(name);
    if (!entry) {
      return { valid: false, errors: ['Unknown tool "' + name + '"'] };
    }
    const parsed = entry.schema.safeParse(args);
    if (parsed.success) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => (i.path.join(".") || "(root)") + ": " + i.message),
    };
  }

  /** Cached tool definition (undefined if not loaded). */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.cache.get(name)?.definition;
  }

  /** All cached tool names. */
  get toolNames(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Generate a TypeScript interface for a tool's arguments (Task 7.3).
   * Example: export interface SmsSendArgs { to: string; body: string; }
   */
  generateTypeDefinition(name: string): string | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    const params = entry.definition.function.parameters;
    const lines = Object.entries(params.properties).map(([key, prop]) => {
      const optional = params.required.includes(key) ? "" : "?";
      return "  " + key + optional + ": " + tsTypeFor(prop) + ";";
    });
    const ifaceName = toolNameToPascal(name) + "Args";
    if (lines.length === 0) return "export interface " + ifaceName + " {}";
    return "export interface " + ifaceName + " {\n" + lines.join("\n") + "\n}";
  }
}

function toolNameToPascal(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function tsTypeFor(prop: ParameterProperty): string {
  if (prop.enum && prop.enum.length > 0) {
    return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  switch (prop.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "unknown[]";
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

/** Build a Zod object schema from JSON-Schema-like tool parameters. */
function buildZodSchema(params: {
  properties: Record<string, ParameterProperty>;
  required: string[];
}): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(params.properties)) {
    let schema = schemaForProperty(prop);
    if (!params.required.includes(key)) {
      schema = schema.optional();
    }
    shape[key] = schema;
  }
  return z.object(shape);
}

function schemaForProperty(prop: ParameterProperty): z.ZodTypeAny {
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.unknown());
    case "object":
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}
