import { describe, it } from "node:test";
import assert from "node:assert";
import { runCommand, runCheckList } from "../src/runner.js";

describe("runner", () => {
  describe("runCommand", () => {
    it("returns success for a valid command", () => {
      const result = runCommand("echo hello");
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.stdout.trim(), "hello");
      assert.strictEqual(result.exitCode, 0);
    });

    it("returns failure for an invalid command", () => {
      const result = runCommand("exit 1");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
    });
  });

  describe("runCheckList", () => {
    it("runs all commands when they succeed", () => {
      const results = runCheckList(["echo one", "echo two"]);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].success, true);
      assert.strictEqual(results[1].success, true);
    });

    it("stops on first failure", () => {
      const results = runCheckList(["echo one", "exit 1", "echo three"]);
      assert.strictEqual(results.length, 2); // fails fast
      assert.strictEqual(results[0].success, true);
      assert.strictEqual(results[1].success, false);
    });
  });
});
