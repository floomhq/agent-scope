# agent-scope

[![npm version](https://img.shields.io/npm/v/agent-scope.svg)](https://www.npmjs.com/package/agent-scope)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](./tests)

**Scoped write access for AI coding agents.**

Stop Claude, Cursor, Codex, and other coding agents from silently changing code outside their intended task boundary. Give them broad read access, narrow write access, and enforce approval for protected modules.

```bash
npm install -g agent-scope
```

---

## The problem

You ask an agent to *"fix the settings page."* It changes:

- `apps/web/settings/page.tsx` ✅ intended
- `packages/auth/session.ts` ❌ silently broken
- `package-lock.json` ⚠️ unexpected side effect
- Some random utility file ❌ now broken

**agent-scope** makes this visible, preventable, and fixable *before* it hits production.

## The solution

```yaml
# agent.scope.yml
version: "0.1"
mode: strict

task:
  id: "email-settings-v2"
  title: "Refactor email settings UI"

scope:
  read:
    - "**/*"
  write:
    - "apps/web/settings/**"
    - "packages/email/**"
  protected:
    - "packages/auth/**"
    - "packages/billing/**"
    - "db/migrations/**"
  approval_required:
    - "package.json"
    - "pnpm-lock.yaml"
```

The agent can **read** the whole repo for context, but can only **write** what you scoped. Touch a protected file and the check fails.

## Quick start

```bash
# 1. Initialize a scope file
agent-scope init

# 2. Edit agent.scope.yml to define boundaries

# 3. Make changes, then validate
agent-scope check

# 4. If the agent needs to touch a protected file
agent-scope request packages/auth/session.ts \
  --reason "Need session field for notification preference"

# 5. Approve the expansion
agent-scope approve packages/auth/session.ts
```

## CLI commands

| Command | Description |
|---------|-------------|
| `agent-scope init` | Create `agent.scope.yml` and `.agent-scope/` directory |
| `agent-scope check` | Validate current git diff against scope |
| `agent-scope run` | Validate scope, then run `checks.before_done` |
| `agent-scope run <cmd>` | Validate scope, then run a custom command |
| `agent-scope request <path>` | Create a scope expansion request |
| `agent-scope approve <path>` | Approve a file or path for the current task |

### Check options

```bash
agent-scope check --base origin/main    # diff against a base branch
agent-scope check --staged              # only staged changes
agent-scope check --unstaged            # only unstaged changes
agent-scope check --json                # JSON output for CI/scripts
agent-scope check --run-checks          # also execute checks.before_done
```

## Example output

```
Agent Scope Check

Task:
Refactor email settings UI

Allowed changes:
✓ apps/web/settings/page.tsx
✓ packages/email/send.ts

Blocked changes:
✕ packages/auth/session.ts
  Reason: protected path

Result: Scope violation found.

Next:
- revert blocked files
- request scope expansion: agent-scope request <path> --reason ...
- approve specific file change: agent-scope approve <path>
```

## Enforcement model

A file change can be in one of five states:

| State | Rule |
|-------|------|
| **allowed** | Matches `scope.write` |
| **protected** | Matches `scope.protected`; blocked unless explicitly approved |
| **approval_required** | Matches `scope.approval_required`; requires approval |
| **approved** | Explicitly approved via `agent-scope approve` |
| **blocked** | Everything else in `strict` mode |

Priority order:

```
protected > approved > approval_required > write > blocked
```

## Modes

**Strict** (default): only `scope.write` files are allowed. Everything else is blocked.

**Warn**: out-of-scope files become warnings (exit `0`), but protected paths are still blocked.

## Why this exists

> *"Work on a feature, things that were already working get altered or broken."*
>
> *"I wish you could freeze code."*
>
> *"Necessary changes to module X should be done based on issues, not based on the agent working on module Y."*

**agent-scope** is granular access control for AI agents. It does not freeze code — it forces cross-module changes to be visible and intentional, not accidental.

- Agents **read broadly** for context
- Agents **write narrowly** by default
- Protected modules require **explicit approval**
- Escalation creates an **audit trail** (request files + approvals)

## CI / GitHub Action

Add `.github/workflows/agent-scope.yml`:

```yaml
name: Agent Scope
on:
  pull_request:
jobs:
  scope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm install -g agent-scope
      - run: agent-scope check --base origin/${{ github.base_ref }}
```

## Claude Code / Cursor / Codex integration

### Hook command

```bash
agent-scope check --json
```

Example JSON output:

```json
{
  "status": "blocked",
  "task_id": "email-settings-v2",
  "violations": [
    {
      "file": "packages/auth/session.ts",
      "reason": "protected path",
      "action": "request_scope_expansion"
    }
  ]
}
```

### Pre-commit hook

```bash
#!/bin/sh
agent-scope run
```

If scope is violated, the commit is blocked. If clean, your tests run automatically.

## Requesting scope expansion

When an agent realizes it needs to touch a protected file:

```bash
agent-scope request packages/auth/session.ts \
  --reason "Need session field for notification preference" \
  --risk-level high \
  --agent-summary "The settings page needs access to user email preference." \
  --suggested-checks "pnpm test packages/auth,pnpm typecheck"
```

This creates `.agent-scope/requests/2026-06-10-email-settings-v2.yml` with full context for human review.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Clean |
| `1` | Violation or approval required |
| `2` | Invalid config / error |

## Installation

```bash
npm install -g agent-scope
```

Or use with `npx`:

```bash
npx agent-scope check
```

Requires Node.js >= 20.

## Monorepo example

```yaml
version: "0.1"
mode: strict

task:
  id: "settings-email-v1"
  title: "Add onboarding email settings"

scope:
  read:
    - "**/*"
  write:
    - "apps/web/settings/**"
    - "packages/email/**"
    - ".agent-scope/**"
  protected:
    - "packages/auth/**"
    - "packages/billing/**"
    - "db/migrations/**"
    - "infra/**"
    - ".env*"
  approval_required:
    - "package.json"
    - "pnpm-lock.yaml"
    - "yarn.lock"
    - "turbo.json"
    - "next.config.*"

checks:
  before_done:
    - "pnpm typecheck"
    - "pnpm test"
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © [Federico De Ponte](https://github.com/federicodeponte)
