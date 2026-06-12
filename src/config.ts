import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { AgentScopeConfig } from "./types.js";

const DEFAULT_CONFIG: Partial<AgentScopeConfig> = {
  mode: "strict",
  scope: {
    read: ["**/*"],
    write: [],
    protected: [],
    approval_required: [],
  },
};

export function loadConfig(cwd: string = process.cwd()): AgentScopeConfig {
  const configPath = path.join(cwd, "agent.scope.yml");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid config: expected YAML object");
  }

  const config = mergeDefaults(parsed);
  validateConfig(config);
  return config;
}

function mergeDefaults(parsed: Record<string, unknown>): AgentScopeConfig {
  const config = { ...DEFAULT_CONFIG, ...parsed } as AgentScopeConfig;

  if (!config.scope) {
    config.scope = { ...DEFAULT_CONFIG.scope };
  } else {
    config.scope = {
      read: config.scope.read ?? DEFAULT_CONFIG.scope!.read,
      write: config.scope.write ?? DEFAULT_CONFIG.scope!.write,
      protected: config.scope.protected ?? DEFAULT_CONFIG.scope!.protected,
      approval_required: config.scope.approval_required ?? DEFAULT_CONFIG.scope!.approval_required,
    };
  }

  return config;
}

export function validateConfig(config: AgentScopeConfig): void {
  if (!config.version) {
    throw new Error("Missing required field: version");
  }

  if (!config.task?.id) {
    throw new Error("Missing required field: task.id");
  }

  if (!config.task?.title) {
    throw new Error("Missing required field: task.title");
  }

  if (config.mode && !["strict", "warn"].includes(config.mode)) {
    throw new Error(`Invalid mode: ${config.mode}. Must be "strict" or "warn"`);
  }

  for (const key of ["read", "write", "protected", "approval_required"] as const) {
    const list = config.scope[key];
    if (list !== undefined && !Array.isArray(list)) {
      throw new Error(`Invalid scope.${key}: expected array of strings`);
    }
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item !== "string") {
          throw new Error(`Invalid scope.${key}: all entries must be strings`);
        }
      }
    }
  }

  if (config.checks?.review !== undefined) {
    const review = config.checks.review;
    if (typeof review !== "object" || review === null) {
      throw new Error("Invalid checks.review: expected object");
    }
    if (review.enabled !== undefined && typeof review.enabled !== "boolean") {
      throw new Error("Invalid checks.review.enabled: expected boolean");
    }
    if (review.model !== undefined && typeof review.model !== "string") {
      throw new Error("Invalid checks.review.model: expected string");
    }
    if (review.models !== undefined) {
      if (!Array.isArray(review.models) || review.models.some((m) => typeof m !== "string")) {
        throw new Error("Invalid checks.review.models: expected array of strings");
      }
    }
    if (review.prompt !== undefined && typeof review.prompt !== "string") {
      throw new Error("Invalid checks.review.prompt: expected string");
    }
    if (review.timeout !== undefined && (typeof review.timeout !== "number" || review.timeout <= 0)) {
      throw new Error("Invalid checks.review.timeout: expected positive number");
    }
    if (review.retries !== undefined && (typeof review.retries !== "number" || review.retries < 0)) {
      throw new Error("Invalid checks.review.retries: expected non-negative number");
    }
    if (review.cache !== undefined && typeof review.cache !== "boolean") {
      throw new Error("Invalid checks.review.cache: expected boolean");
    }
    if (review.provider !== undefined) {
      if (typeof review.provider !== "object" || review.provider === null) {
        throw new Error("Invalid checks.review.provider: expected object");
      }
      if (review.provider.base_url !== undefined && typeof review.provider.base_url !== "string") {
        throw new Error("Invalid checks.review.provider.base_url: expected string");
      }
      if (review.provider.api_key_env !== undefined && typeof review.provider.api_key_env !== "string") {
        throw new Error("Invalid checks.review.provider.api_key_env: expected string");
      }
    }
  }
}

export function defaultConfig(taskId: string, title: string): AgentScopeConfig {
  return {
    version: "0.1",
    mode: "strict",
    task: {
      id: taskId,
      title,
    },
    scope: {
      read: ["**/*"],
      write: [".agent-scope/**"],
      protected: [],
      approval_required: [],
    },
  };
}
