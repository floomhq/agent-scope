import { describe, it } from "node:test";
import assert from "node:assert";
import { validateConfig } from "../config.js";
import type { AgentScopeConfig } from "../types.js";

function baseConfig(): AgentScopeConfig {
  return {
    version: "0.1",
    task: { id: "t1", title: "Test" },
    scope: { read: ["**/*"], write: [], protected: [], approval_required: [] },
  };
}

describe("config", () => {
  describe("validateConfig", () => {
    it("passes for a valid config", () => {
      assert.doesNotThrow(() => validateConfig(baseConfig()));
    });

    it("throws when version is missing", () => {
      const config = { task: { id: "t1", title: "Test" } } as AgentScopeConfig;
      assert.throws(() => validateConfig(config), /version/);
    });

    it("throws when task.id is missing", () => {
      const config = { version: "0.1", task: { title: "Test" } } as AgentScopeConfig;
      assert.throws(() => validateConfig(config), /task\.id/);
    });

    it("throws when task.title is missing", () => {
      const config = { version: "0.1", task: { id: "t1" } } as AgentScopeConfig;
      assert.throws(() => validateConfig(config), /task\.title/);
    });

    it("throws for invalid mode", () => {
      const config = baseConfig();
      config.mode = "invalid" as "strict";
      assert.throws(() => validateConfig(config), /mode/);
    });

    it("passes for valid review config", () => {
      const config = baseConfig();
      config.checks = {
        review: {
          enabled: true,
          model: "gpt-4o-mini",
          prompt: "custom prompt",
          provider: {
            base_url: "https://openrouter.ai/api/v1",
            api_key_env: "OPENROUTER_API_KEY",
          },
        },
      };
      assert.doesNotThrow(() => validateConfig(config));
    });

    it("throws for invalid review.enabled type", () => {
      const config = baseConfig();
      config.checks = { review: { enabled: "yes" as unknown as boolean } };
      assert.throws(() => validateConfig(config), /enabled/);
    });

    it("throws for invalid review.model type", () => {
      const config = baseConfig();
      config.checks = { review: { model: 123 as unknown as string } };
      assert.throws(() => validateConfig(config), /model/);
    });

    it("throws for invalid review.prompt type", () => {
      const config = baseConfig();
      config.checks = { review: { prompt: 123 as unknown as string } };
      assert.throws(() => validateConfig(config), /prompt/);
    });

    it("throws for invalid review.provider.base_url type", () => {
      const config = baseConfig();
      config.checks = { review: { provider: { base_url: 123 as unknown as string } } };
      assert.throws(() => validateConfig(config), /base_url/);
    });

    it("throws for invalid review.provider.api_key_env type", () => {
      const config = baseConfig();
      config.checks = { review: { provider: { api_key_env: 123 as unknown as string } } };
      assert.throws(() => validateConfig(config), /api_key_env/);
    });

    it("throws for invalid review.models type", () => {
      const config = baseConfig();
      config.checks = { review: { models: "model" as unknown as string[] } };
      assert.throws(() => validateConfig(config), /models/);
    });

    it("throws for invalid review.timeout type", () => {
      const config = baseConfig();
      config.checks = { review: { timeout: 0 } };
      assert.throws(() => validateConfig(config), /timeout/);
    });

    it("throws for invalid review.retries type", () => {
      const config = baseConfig();
      config.checks = { review: { retries: -1 } };
      assert.throws(() => validateConfig(config), /retries/);
    });

    it("throws for invalid review.cache type", () => {
      const config = baseConfig();
      config.checks = { review: { cache: "yes" as unknown as boolean } };
      assert.throws(() => validateConfig(config), /cache/);
    });
  });
});
