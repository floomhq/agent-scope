import { describe, it, before } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { reviewDiff, buildReviewPrompt, resolveProvider, resolveModels, hasBlockingConcerns, hasHighSeverityConcerns } from "../review.js";
import { getCachedResult, setCachedResult, hashDiff, hashConfig } from "../review-cache.js";
import type { AgentScopeConfig } from "../types.js";

before(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

function makeConfig(review?: NonNullable<AgentScopeConfig["checks"]>["review"]): AgentScopeConfig {
  return {
    version: "0.1",
    task: { id: "t1", title: "Test" },
    scope: { read: ["**/*"], write: ["**/*"] },
    checks: review ? { review: { cache: false, ...review } } : undefined,
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-scope-review-test-"));
}

function makeFetchResponse(content: string): typeof fetch {
  return async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    } as Response);
}

describe("review", () => {
  describe("buildReviewPrompt", () => {
    it("uses default prompt when none configured", () => {
      const prompt = buildReviewPrompt();
      assert.ok(prompt.includes("git diff"));
      assert.ok(prompt.includes("JSON"));
      assert.ok(prompt.includes("Do not flag trivial refactors"));
    });

    it("uses configured prompt", () => {
      const prompt = buildReviewPrompt({ prompt: "custom prompt" });
      assert.strictEqual(prompt, "custom prompt");
    });
  });

  describe("resolveProvider", () => {
    it("defaults to OpenAI", () => {
      delete process.env.OPENAI_API_KEY;
      const provider = resolveProvider();
      assert.strictEqual(provider.baseUrl, "https://api.openai.com/v1");
      assert.strictEqual(provider.apiKey, undefined);
      process.env.OPENAI_API_KEY = "test-key";
    });

    it("reads custom env var", () => {
      process.env.CUSTOM_KEY = "secret";
      const provider = resolveProvider({ api_key_env: "CUSTOM_KEY" });
      assert.strictEqual(provider.apiKey, "secret");
      delete process.env.CUSTOM_KEY;
    });

    it("reads custom base URL", () => {
      const provider = resolveProvider({ base_url: "https://openrouter.ai/api/v1/" });
      assert.strictEqual(provider.baseUrl, "https://openrouter.ai/api/v1");
    });
  });

  describe("resolveModels", () => {
    it("uses models array when provided", () => {
      assert.deepStrictEqual(resolveModels({ models: ["a", "b"] }), ["a", "b"]);
    });

    it("falls back to single model", () => {
      assert.deepStrictEqual(resolveModels({ model: "gpt-4o" }), ["gpt-4o"]);
    });

    it("uses default model", () => {
      assert.deepStrictEqual(resolveModels(undefined), ["gpt-4o-mini"]);
    });
  });

  describe("reviewDiff", () => {
    it("returns clean when review is disabled", async () => {
      const config = makeConfig({ enabled: false });
      const result = await reviewDiff({ diff: "some diff", config });
      assert.strictEqual(result.clean, true);
      assert.strictEqual(result.concerns.length, 0);
    });

    it("parses a clean review response", async () => {
      const config = makeConfig({ model: "test-model" });
      const fetcher = makeFetchResponse(JSON.stringify({ clean: true, summary: "Looks good.", concerns: [] }));
      const result = await reviewDiff({ diff: "some diff", config, fetcher });
      assert.strictEqual(result.clean, true);
      assert.strictEqual(result.summary, "Looks good.");
      assert.strictEqual(result.concerns.length, 0);
    });

    it("parses a review response with concerns", async () => {
      const config = makeConfig({ model: "test-model" });
      const fetcher = makeFetchResponse(
        JSON.stringify({
          clean: false,
          summary: "Found issues.",
          concerns: [
            { severity: "high", file: "button.tsx", description: "Hover state removed.", suggested_checks: ["pnpm test button"] },
          ],
        })
      );
      const result = await reviewDiff({ diff: "some diff", config, fetcher });
      assert.strictEqual(result.clean, false);
      assert.strictEqual(result.concerns.length, 1);
      assert.strictEqual(result.concerns[0].severity, "high");
    });

    it("throws when API key is missing for non-local provider", async () => {
      const config = makeConfig({ model: "test-model", provider: { api_key_env: "UNSET_REVIEW_KEY" } });
      await assert.rejects(
        () => reviewDiff({ diff: "some diff", config, fetcher: makeFetchResponse("") }),
        /No API key found/
      );
    });

    it("does not require API key for localhost", async () => {
      const config = makeConfig({ model: "test-model", provider: { base_url: "http://localhost:11434/v1" } });
      const fetcher = makeFetchResponse(JSON.stringify({ clean: true, summary: "OK", concerns: [] }));
      const result = await reviewDiff({ diff: "some diff", config, fetcher });
      assert.strictEqual(result.clean, true);
    });

    it("throws on invalid JSON response", async () => {
      const config = makeConfig({ model: "test-model", retries: 0 });
      const fetcher = makeFetchResponse("not json");
      await assert.rejects(() => reviewDiff({ diff: "some diff", config, fetcher }));
    });

    it("throws on API error", async () => {
      const config = makeConfig({ model: "test-model", retries: 0 });
      const fetcher = async () =>
        ({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async () => "rate limited",
        } as Response);
      await assert.rejects(() => reviewDiff({ diff: "some diff", config, fetcher }), /429/);
    });

    it("retries on rate limit then succeeds", async () => {
      const config = makeConfig({ model: "test-model", retries: 2 });
      let calls = 0;
      const fetcher = async () => {
        calls++;
        if (calls < 2) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            text: async () => "rate limited",
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ clean: true, summary: "OK", concerns: [] }) } }] }),
        } as Response;
      };
      const result = await reviewDiff({ diff: "some diff", config, fetcher });
      assert.strictEqual(result.clean, true);
      assert.strictEqual(calls, 2);
    });

    it("falls back to next model on failure", async () => {
      const config = makeConfig({ models: ["failing-model", "success-model"], retries: 0 });
      const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.model === "failing-model") {
          return {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: async () => "boom",
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ clean: true, summary: "OK", concerns: [] }) } }] }),
        } as Response;
      };
      const result = await reviewDiff({ diff: "some diff", config, fetcher });
      assert.strictEqual(result.clean, true);
    });

    it("times out slow requests", async () => {
      const config = makeConfig({ model: "test-model", timeout: 50, retries: 0 });
      const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => reject(new Error("The operation was aborted."));
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          init?.signal?.addEventListener("abort", onAbort);
          setTimeout(() => {
            init?.signal?.removeEventListener("abort", onAbort);
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ clean: true, summary: "OK", concerns: [] }) } }] }),
            } as Response);
          }, 500);
        });
      };
      await assert.rejects(() => reviewDiff({ diff: "some diff", config, fetcher }), /aborted/);
    });
  });

  describe("review cache", () => {
    it("caches and returns cached result", () => {
      const cwd = makeTempDir();
      const diff = "same diff";
      const config = { model: "test-model" };
      const result: ReturnType<typeof getCachedResult> = { clean: true, summary: "Cached", concerns: [] };

      assert.strictEqual(getCachedResult(diff, config, cwd), undefined);
      setCachedResult(diff, config, result, cwd);
      const cached = getCachedResult(diff, config, cwd);
      assert.deepStrictEqual(cached, result);

      fs.rmSync(cwd, { recursive: true, force: true });
    });

    it("uses cache in reviewDiff when enabled", async () => {
      const cwd = makeTempDir();
      const diff = "cached diff";
      const config = makeConfig({ model: "test-model", cache: true });
      const cachedResult = { clean: true, summary: "Already reviewed", concerns: [] };
      setCachedResult(diff, config.checks!.review, cachedResult, cwd);

      let called = false;
      const fetcher = async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] }) } as Response;
      };

      const result = await reviewDiff({ diff, config, cwd, fetcher });
      assert.strictEqual(called, false);
      assert.ok(result.summary.includes("cached"));

      fs.rmSync(cwd, { recursive: true, force: true });
    });

    it("hashes diff and config consistently", () => {
      assert.strictEqual(hashDiff("abc"), hashDiff("abc"));
      assert.notStrictEqual(hashDiff("abc"), hashDiff("def"));
      assert.strictEqual(hashConfig({ model: "a" }), hashConfig({ model: "a" }));
      assert.notStrictEqual(hashConfig({ model: "a" }), hashConfig({ model: "b" }));
    });
  });

  describe("hasBlockingConcerns", () => {
    it("returns true for high or medium severity", () => {
      assert.strictEqual(hasBlockingConcerns({ clean: false, summary: "", concerns: [{ severity: "medium", description: "" }] }), true);
      assert.strictEqual(hasBlockingConcerns({ clean: true, summary: "", concerns: [] }), false);
      assert.strictEqual(hasBlockingConcerns({ clean: false, summary: "", concerns: [{ severity: "low", description: "" }] }), false);
    });
  });

  describe("hasHighSeverityConcerns", () => {
    it("returns true only for high severity", () => {
      assert.strictEqual(hasHighSeverityConcerns({ clean: false, summary: "", concerns: [{ severity: "high", description: "" }] }), true);
      assert.strictEqual(hasHighSeverityConcerns({ clean: false, summary: "", concerns: [{ severity: "medium", description: "" }] }), false);
    });
  });
});
