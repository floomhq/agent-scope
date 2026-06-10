# Contributing to agent-scope

Thanks for helping make agent-scope better.

## Getting started

```bash
git clone https://github.com/federicodeponte/agent-scope.git
cd agent-scope
npm install
npm run build
npm test
```

## Project structure

```
src/
  cli.ts        Entry point
  config.ts     YAML loading and validation
  git.ts        Git diff and untracked files
  matcher.ts    Glob pattern matching
  policy.ts     Scope classification engine
  approvals.ts  Approval file read/write
  requests.ts   Scope expansion requests
  reporter.ts   Terminal and JSON output
  runner.ts     Shell command execution
tests/          Unit tests
examples/       Sample configs and CI templates
```

## Guidelines

- Keep changes minimal and focused.
- Add tests for new policy or matching behavior.
- Follow the existing TypeScript style.
- Update `README.md` if CLI behavior changes.

## Running tests

```bash
npm test
```

## Releasing

Maintainers only:

```bash
npm version patch|minor|major
npm publish
```
