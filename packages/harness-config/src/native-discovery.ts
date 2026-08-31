import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  HarnessNativeConfigurationSummary,
} from "@codexhost/shared-contracts";

import type { HarnessEndpointConfig } from "./index.js";

export interface NativeHarnessConfigurationDiscovery {
  readonly summary: HarnessNativeConfigurationSummary;
  /** Raw values are kept inside the Host process for an explicit import only. */
  readonly endpoint?: HarnessEndpointConfig;
}

interface SourceValue {
  readonly path?: string;
  readonly kind: "environment" | "settings-file" | "oauth-file";
}

interface NativeValues {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  readonly environmentKeys: Set<string>;
  readonly sources: SourceValue[];
  readonly warnings: string[];
  oauth: boolean;
  unreadable: boolean;
}

const ENVIRONMENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "claude-code": [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
  ],
  gemini: ["GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL"],
  grok: ["GROK_MODELS_BASE_URL", "XAI_API_KEY", "GROK_DEFAULT_MODEL"],
  "deepseek-harness": ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY"],
  pi: ["PI_CODING_AGENT_DIR", "PI_MODEL", "PI_PROVIDER"],
  omp: ["OMP_MODEL", "OMP_PROVIDER", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
};

function homeDirectory(environment: NodeJS.ProcessEnv): string {
  return environment.HOME ?? environment.USERPROFILE ?? os.homedir();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length < 8 ? "********" : `****${value.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function addEnvironmentValues(
  values: NativeValues,
  environment: Record<string, unknown>,
  source: SourceValue,
): void {
  for (const [key, raw] of Object.entries(environment)) {
    const value = stringValue(raw);
    if (!value) continue;
    values.environmentKeys.add(key);
    if (source.kind === "environment") values.sources.push(source);
    if (key.endsWith("BASE_URL") || key === "OPENAI_BASE_URL") values.baseUrl ??= value;
    if (key === "ANTHROPIC_API_KEY" || key === "ANTHROPIC_AUTH_TOKEN") {
      values.apiKey ??= value;
      values.apiKeyEnv ??= key;
    } else if (
      key === "GEMINI_API_KEY" ||
      key === "GOOGLE_API_KEY" ||
      key === "XAI_API_KEY" ||
      key === "DEEPSEEK_API_KEY" ||
      key === "OPENAI_API_KEY"
    ) {
      values.apiKey ??= value;
      values.apiKeyEnv ??= key;
    }
    if (key.endsWith("_MODEL") || key === "PI_MODEL" || key === "OMP_MODEL") {
      values.model ??= value;
    }
  }
}

function authType(values: NativeValues): HarnessNativeConfigurationSummary["authType"] {
  if (values.baseUrl) return "third-party-gateway";
  if (values.apiKey) return "official-api-key";
  if (values.oauth) return "oauth";
  if (values.environmentKeys.size > 0) return "environment";
  return "none";
}

function makeResult(values: NativeValues): NativeHarnessConfigurationDiscovery {
  const type = authType(values);
  const detected =
    values.environmentKeys.size > 0 || values.sources.length > 0 || values.oauth || values.apiKey;
  const summary: HarnessNativeConfigurationSummary = {
    status: detected ? "detected" : values.unreadable ? "unreadable" : "not-found",
    authType: type,
    ...(values.baseUrl && validUrl(values.baseUrl) ? { baseUrl: validUrl(values.baseUrl) } : {}),
    apiKeyConfigured: values.apiKey !== undefined,
    ...(values.apiKey ? { apiKeyHint: maskSecret(values.apiKey) } : {}),
    ...(values.apiKeyEnv ? { apiKeyEnv: values.apiKeyEnv } : {}),
    ...(values.model ? { model: values.model } : {}),
    environmentKeys: [...values.environmentKeys].sort(),
    sources: values.sources.filter(
      (source, index, all) =>
        all.findIndex(
          (candidate) => candidate.kind === source.kind && candidate.path === source.path,
        ) === index,
    ),
    warnings: values.warnings,
  };
  const endpoint: HarnessEndpointConfig | undefined = detected
    ? {
        ...(values.baseUrl && validUrl(values.baseUrl) ? { baseUrl: validUrl(values.baseUrl) } : {}),
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        ...(values.apiKeyEnv ? { apiKeyEnv: values.apiKeyEnv } : {}),
        ...(values.model ? { model: values.model } : {}),
      }
    : undefined;
  return { summary, ...(endpoint ? { endpoint } : {}) };
}

export async function discoverNativeHarnessConfiguration(
  harnessId: string,
  environment: NodeJS.ProcessEnv,
): Promise<NativeHarnessConfigurationDiscovery> {
  const values: NativeValues = {
    environmentKeys: new Set(),
    sources: [],
    warnings: [],
    oauth: false,
    unreadable: false,
  };
  const allowedKeys = new Set(ENVIRONMENT_KEYS[harnessId] ?? []);
  const environmentValues: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (stringValue(environment[key])) environmentValues[key] = environment[key];
  }
  addEnvironmentValues(values, environmentValues, { kind: "environment" });

  if (harnessId !== "claude-code") return makeResult(values);

  const home = homeDirectory(environment);
  const settingsPath = path.join(home, ".claude", "settings.json");
  try {
    const settings = await readJson(settingsPath);
    if (isRecord(settings) && isRecord(settings.env)) {
      const filtered = Object.fromEntries(
        Object.entries(settings.env).filter(([key]) => allowedKeys.has(key)),
      );
      if (Object.keys(filtered).length > 0) {
        addEnvironmentValues(values, filtered, { kind: "settings-file", path: settingsPath });
        values.sources.push({ kind: "settings-file", path: settingsPath });
      }
    }
  } catch (error) {
    values.unreadable = true;
    values.warnings.push(error instanceof Error ? error.message : String(error));
  }

  for (const credentialsPath of [
    path.join(home, ".claude.json"),
    path.join(home, ".claude", ".credentials.json"),
  ]) {
    try {
      const credentials = await readJson(credentialsPath);
      if (
        isRecord(credentials) &&
        (isRecord(credentials.oauthAccount) ||
          isRecord(credentials.claudeAiOauth) ||
          typeof credentials.accessToken === "string")
      ) {
        values.oauth = true;
        values.sources.push({ kind: "oauth-file", path: credentialsPath });
      }
    } catch (error) {
      values.unreadable = true;
      values.warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return makeResult(values);
}
