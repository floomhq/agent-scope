import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateFile, evaluateAll } from "../policy.js";
import type { AgentScopeConfig, ApprovalEntry } from "../types.js";

function makeConfig(overrides: Partial<AgentScopeConfig["scope"] & { mode?: "strict" | "warn" }> = {}): AgentScopeConfig {
  return {
    version: "0.1",
    mode: overrides.mode ?? "strict",
    task: { id: "t1", title: "Test" },
    scope: {
      read: ["**/*"],
      write: overrides.write ?? [],
      protected: overrides.protected ?? [],
      approval_required: overrides.approval_required ?? [],
    },
  };
}

describe("policy", () => {
  describe("evaluateFile", () => {
    it("allows files in write scope", () => {
      const config = makeConfig({ write: ["apps/web/**"] });
      const result = evaluateFile("apps/web/page.tsx", config, []);
      assert.strictEqual(result.status, "allowed");
    });

    it("blocks protected files", () => {
      const config = makeConfig({ protected: ["packages/auth/**"] });
      const result = evaluateFile("packages/auth/session.ts", config, []);
      assert.strictEqual(result.status, "blocked");
      assert.strictEqual(result.reason, "protected path");
    });

    it("approves protected files with an approval entry", () => {
      const config = makeConfig({ protected: ["packages/auth/**"] });
      const approvals: ApprovalEntry[] = [
        { path: "packages/auth/**", task_id: "t1", approved_by: "human", created_at: "2024-01-01T00:00:00Z" },
      ];
      const result = evaluateFile("packages/auth/session.ts", config, approvals);
      assert.strictEqual(result.status, "approved");
    });

    it("requires approval for approval_required patterns", () => {
      const config = makeConfig({ approval_required: ["package.json"] });
      const result = evaluateFile("package.json", config, []);
      assert.strictEqual(result.status, "approval_required");
    });

    it("blocks out-of-scope files in strict mode", () => {
      const config = makeConfig({ mode: "strict" });
      const result = evaluateFile("random.ts", config, []);
      assert.strictEqual(result.status, "blocked");
      assert.strictEqual(result.reason, "not in write scope");
    });

    it("warns for out-of-scope files in warn mode", () => {
      const config = makeConfig({ mode: "warn" });
      const result = evaluateFile("random.ts", config, []);
      assert.strictEqual(result.status, "warning");
    });

    it("prioritizes protected over approval_required", () => {
      const config = makeConfig({
        protected: ["packages/auth/**"],
        approval_required: ["packages/**"],
      });
      const result = evaluateFile("packages/auth/session.ts", config, []);
      assert.strictEqual(result.status, "blocked");
    });
  });

  describe("evaluateAll", () => {
    it("categorizes mixed files", () => {
      const config = makeConfig({
        write: ["apps/web/**"],
        protected: ["packages/auth/**"],
      });
      const result = evaluateAll(
        ["apps/web/page.tsx", "packages/auth/session.ts", "other.ts"],
        config,
        []
      );
      assert.strictEqual(result.allowed.length, 1);
      assert.strictEqual(result.violations.length, 2);
    });
  });
});
