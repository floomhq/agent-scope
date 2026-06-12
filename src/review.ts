import type { AgentScopeConfig, ReviewConfig, ReviewProviderConfig, ReviewResult } from "./types.js";
import { getCachedResult, setCachedResult } from "./review-cache.js";

const DEFAULT_REVIEW_PROMPT = `You are a strict code reviewer reviewing a git diff for an AI coding agent task.

Your job: identify behavioral regressions, shortcut implementations, and missing verification that could silently break existing features.

Severity guide:
- HIGH: existing behavior is removed or broken (hover/focus/click disabled, API field removed, test deleted without replacement, migration that loses data)
- MEDIUM: likely unintended side effect or missing verification (new prop made required, styling changed without tests, dependency added)
- LOW: minor concern, code smell, or something to double-check

Focus on:
- UI interactions (hover, focus, click, disabled states, animations)
- API contract changes (removed fields, changed response shapes, newly required props)
- Database / migration side effects
- Missing tests for changed behavior
- Removed functionality that looks accidental

Do not flag trivial refactors like:
- Renaming a local variable
- Changing a color shade from blue-600 to blue-700
- Extracting a helper without changing behavior
- Formatting changes

Return ONLY a JSON object with this exact shape:
{
  "clean": boolean,
  "summary": "one sentence verdict",
  "concerns": [
    {
      "severity": "low" | "medium" | "high",
      "file": "optional affected file path",
      "description": "what might be wrong and why",
      "suggested_checks": ["optional test command or verification step"]
    }
  ]
}

If the diff looks safe and complete, return clean: true with an empty concerns array.

Diff to review:
`;

export function buildReviewPrompt(config?: ReviewConfig): string {
  return config?.prompt?.trim() || DEFAULT_REVIEW_PROMPT;
}

export function resolveProvider(config?: ReviewProviderConfig): {
  baseUrl: string;
  apiKey: string | undefined;
} {
  const baseUrl = config?.base_url?.replace(/\/$/, "") || "https://api.openai.com/v1";
  const apiKeyEnv = config?.api_key_env || "OPENAI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  return { baseUrl, apiKey };
}

export function resolveModels(config?: ReviewConfig): string[] {
  if (config?.models && config.models.length > 0) {
    return config.models;
  }
  if (config?.model) {
    return [config.model];
  }
  return ["gpt-4o-mini"];
}

export interface ReviewOptions {
  diff: string;
  config: AgentScopeConfig;
  cwd?: string;
  fetcher?: typeof fetch;
}

function isRetryableError(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetcher: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callReviewModel(
  diff: string,
  reviewConfig: ReviewConfig | undefined,
  model: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  retries: number
): Promise<ReviewResult> {
  const { baseUrl, apiKey } = resolveProvider(reviewConfig?.provider);
  const prompt = buildReviewPrompt(reviewConfig);

  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: diff },
  ];

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        },
        timeoutMs,
        fetcher
      );

      if (!response.ok) {
        const text = await response.text();
        if (isRetryableError(response.status) && attempt < retries) {
          lastError = new Error(`Review request failed: ${response.status} ${response.statusText} - ${text}`);
          const backoffMs = Math.min(1000 * 2 ** attempt, 10000);
          await delay(backoffMs);
          continue;
        }
        throw new Error(`Review request failed: ${response.status} ${response.statusText} - ${text}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Review response missing content.");
      }

      return parseReviewResponse(content);
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      if ((isTimeout || err instanceof TypeError) && attempt < retries) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const backoffMs = Math.min(1000 * 2 ** attempt, 10000);
        await delay(backoffMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Review request failed after retries.");
}

function parseReviewResponse(content: string): ReviewResult {
  let parsed: ReviewResult;
  try {
    parsed = JSON.parse(content) as ReviewResult;
  } catch (err) {
    throw new Error(`Failed to parse review response as JSON: ${err instanceof Error ? err.message : String(err)}\n\n${content}`);
  }

  if (typeof parsed.clean !== "boolean" || !Array.isArray(parsed.concerns)) {
    throw new Error("Review response has invalid shape.");
  }

  return parsed;
}

export async function reviewDiff({ diff, config, cwd = process.cwd(), fetcher = fetch }: ReviewOptions): Promise<ReviewResult> {
  const reviewConfig = config.checks?.review;
  if (reviewConfig?.enabled === false) {
    return { clean: true, summary: "Review disabled.", concerns: [] };
  }

  const useCache = reviewConfig?.cache !== false;
  if (useCache) {
    const cached = getCachedResult(diff, reviewConfig, cwd);
    if (cached) {
      return { ...cached, summary: `${cached.summary} (cached)` };
    }
  }

  const { baseUrl, apiKey } = resolveProvider(reviewConfig?.provider);

  if (!apiKey && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
    throw new Error(`No API key found. Set ${reviewConfig?.provider?.api_key_env || "OPENAI_API_KEY"} environment variable.`);
  }

  const models = resolveModels(reviewConfig);
  const timeoutMs = reviewConfig?.timeout ?? 60000;
  const retries = reviewConfig?.retries ?? 2;

  let lastError: Error | undefined;

  for (const model of models) {
    try {
      const result = await callReviewModel(diff, reviewConfig, model, fetcher, timeoutMs, retries);
      if (useCache) {
        setCachedResult(diff, reviewConfig, result, cwd);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Try next model in fallback list
    }
  }

  throw lastError || new Error("All review models failed.");
}

export function hasHighSeverityConcerns(result: ReviewResult): boolean {
  return result.concerns.some((c) => c.severity === "high");
}

export function hasBlockingConcerns(result: ReviewResult): boolean {
  return result.concerns.some((c) => c.severity === "high" || c.severity === "medium");
}
