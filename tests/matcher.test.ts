import { describe, it } from "node:test";
import assert from "node:assert";
import { matchAny, normalizePath } from "../src/matcher.js";

describe("matcher", () => {
  describe("normalizePath", () => {
    it("removes leading ./", () => {
      assert.strictEqual(normalizePath("./apps/web/index.ts"), "apps/web/index.ts");
    });

    it("normalizes backslashes", () => {
      assert.strictEqual(normalizePath("apps\\web\\index.ts"), "apps/web/index.ts");
    });

    it("leaves clean paths alone", () => {
      assert.strictEqual(normalizePath("apps/web/index.ts"), "apps/web/index.ts");
    });
  });

  describe("matchAny", () => {
    it("matches a simple glob", () => {
      assert.strictEqual(matchAny("apps/web/index.ts", ["apps/web/**"]), true);
    });

    it("does not match unrelated paths", () => {
      assert.strictEqual(matchAny("packages/auth/session.ts", ["apps/web/**"]), false);
    });

    it("matches dotfiles when dot is set", () => {
      assert.strictEqual(matchAny(".env.local", [".env*"]), true);
    });

    it("returns false for empty patterns", () => {
      assert.strictEqual(matchAny("anything.ts", []), false);
    });
  });
});
