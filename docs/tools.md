# Optional tools

These are small helpers for the agent, not a new build system. Prefer your repo's existing language-aware lint and test tools

Both commands require Node.js 22+ and Git, and `--root` must be the Git working-tree root. They read current tracked files, including unstaged changes, not the committed version. Untracked and ignored-untracked files are out of scope

Run from this clone, or replace `scripts/` with the absolute path to the installed skill's `scripts/` directory. Use `--help` for full limits and exclusions

## Inspect: find the existing checks

```sh
node scripts/inspect.mjs --root /path/to/repo
node scripts/inspect.mjs --root /path/to/repo --json
```

The inventory includes package locations and script names, suggested invocations, test and CI paths, lint/type configuration, tracked Git status, and lightweight review leads such as suppressions and TODOs

It does not execute the discovered commands, judge their safety, or interpret a TODO as a defect. Suggestions are leads; read package scripts before running them

The JSON includes `schemaVersion`, `scope`, `root`, `summary`, `packages`, `verification`, `signals`, `coverage`, and `warnings`. Read `coverage.complete` and the skipped reasons. Exit 0 means an inventory was produced, not that the repo is clean or fully inspected. Invalid arguments or failed enumeration exit 2

At most 50 signal locations are displayed; total and omitted counts remain visible. Limits are 1 MiB per file, 64 MiB of reads, and 10,000 scanned files. Dependency/generated folders, lockfile contents, binaries, symlinks, and secret-looking paths are skipped. Paths must not have symlink ancestors

Outputs avoid source excerpts, package script bodies, and environment values. Filename exclusions are heuristics, not a secret scanner. File and package names can still be sensitive; keep reports local unless sharing is intended

## Guard: stop a specific mistake

Create `.steward.json` in the target repository, adapted from [this example](../examples/steward.json):

```json
{
  "version": 1,
  "rules": [
    {
      "id": "no-legacy-client",
      "files": ["src/**/*.ts", "src/**/*.tsx"],
      "exclude": ["src/legacy/**"],
      "forbid": ["@app/legacy-client"],
      "message": "Use @app/client instead; keep the legacy adapter inside src/legacy/"
    }
  ]
}
```

Then run:

```sh
node scripts/guard.mjs --root /path/to/repo
node scripts/guard.mjs --root /path/to/repo --config .steward.json --json
```

**What this does:** detects the exact text `@app/legacy-client` in tracked TypeScript files under `src`, except inside `src/legacy`

**What it does not do:** resolve aliases, parse imports, detect dynamically assembled strings, or infer dependencies. Comments and string literals count. Use an existing lint rule when those distinctions matter

### Configuration rules

- `version` must be `1`; `rules` must contain at least one rule
- Each rule has a unique lowercase hyphenated `id`, `files`, `forbid`, and an actionable `message`; `exclude` is optional
- `files` and `exclude` use root-relative paths with `*`, `?`, and whole-segment `**`. `src/**/*.ts` includes `src/a.ts`
- Braces, brackets, extglobs, absolute paths, backslashes, and `.` / `..` segments are rejected
- `forbid` holds nonempty, single-line, case-sensitive literal strings, not regular expressions
- Unknown keys and empty selections are errors, so a misspelled option or path cannot silently pass

Keep config inside the repository. Symlinked configurations are rejected. Nothing is enabled by default, and the tool never edits config or creates a baseline

### Results

- Exit **0**: every rule could be checked and no forbidden text matched
- Exit **1**: complete scan with violations
- Exit **2**: invalid input or incomplete scan, even if violations were also found

A finding reports file, line, rule ID, and configured remediation message, without the source snippet or forbidden token. One line containing two different forbidden tokens can produce two findings

Dependency/generated directories are globally excluded. After those and per-rule exclusions, every rule must select at least one eligible tracked file. A selected file that is missing, unreadable, symlinked, binary/non-UTF-8, larger than 1 MiB, or secret-looking makes the scan incomplete. Untracked files are excluded with a warning, not silently included

### Adopt safely

1. Choose one real recurring mistake and a narrow scope
2. Demonstrate a violation, then a passing correction
3. Review exemptions as deliberate policy choices
4. Add the exact command to your existing CI only after the test is meaningful

Commit new source files so CI sees them. Do not use this as a security boundary or a substitute for checking the actual application behavior. Run against a stable working tree: neither tool creates a filesystem snapshot
