import { describe, it } from "node:test";
import assert from "node:assert";
import { validateConfig } from "../config.js";
import type { AgentScopeConfig } from "../types.js";

describe("config", () => {
  describe("validateConfig", () => {
    it("passes for a valid config", () => {
      const config: AgentScopeConfig = {
        version: "0.1",
        task: { id: "t1", title: "Test" },
        scope: { read: ["**/*"], write: [], protected: [], approval_required: [] },
      };
      assert.doesNotThrow(() => validateConfig(config));
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
      const config: AgentScopeConfig = {
        version: "0.1",
        mode: "invalid" as "strict",
        task: { id: "t1", title: "Test" },
        scope: {},
      };
      assert.throws(() => validateConfig(config), /mode/);
    });
  });
});
