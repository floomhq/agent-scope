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
