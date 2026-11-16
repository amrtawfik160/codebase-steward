#!/usr/bin/env node
// Standalone on purpose: copy this file with the skill, no install step required.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * MAX_FILE_BYTES;
const MAX_SCAN_FILES = 10000;
const SIGNAL_LIMIT = 50;
const LOCKS = new Map([
  ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
]);
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'bower_components', '.venv', 'venv',
  'dist', 'build', 'coverage', 'generated', '__generated__', '.next', '.nuxt',
  '.output', '.cache', '.turbo', 'target', '__pycache__',
]);
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|ico|avif|pdf|zip|gz|tgz|bz2|xz|7z|tar|woff2?|ttf|otf|mp[34]|mov|wav|ogg|exe|dll|so|dylib|class|jar|pyc|wasm|sqlite3?|db|bin)$/i;
const HELP = `Usage: node inspect.mjs --root /repository [--json]
       node inspect.mjs --help

Advisory inventory, not an audit, score, or clean bill of health
Requires Node >=22 and Git. --root must be the Git top-level directory
Reads tracked working-tree files (including local edits), not committed blobs
Untracked/ignored files are not inspected; tracked ignored files remain in scope
Reports file/extension counts, package script names and suggested invocations,
CI/test/lint/type paths, tracked Git status, and path/line/category signals
No source snippets, script bodies, environment values, or credentials are printed
No writes, network access, package installs, or script execution

Limits: 1 MiB per file, 64 MiB total read budget, 10,000 files scanned
Git output is limited to 32 MiB per command; exceeding it fails with exit 2
At most 50 signal locations printed; full detected and omitted counts reported
Skips dependency/generated directories, lockfile contents, binary files,
all .env variants and credential/key-looking paths, symlinks and their descendants
Root and its ancestors must not be symlinks. Exclusions are filename heuristics,
not a secret detector. Text must be UTF-8. Detection is lightweight, not parsing
No file-system snapshot/locking: avoid concurrent changes during inspection
coverage.complete is false whenever any tracked file is skipped or a warning occurs
Unreadable/invalid files produce warnings and incomplete inventory (exit 0)
Invalid arguments, missing Git/root, or failed enumeration exit 2
`;

function git(root, args) {
  // Inherited Git routing/config variables must not redirect this explicit root.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_OPTIONAL_LOCKS = '0';
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', '-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 32 * MAX_FILE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
}

// Check every ancestor before opening anything. O_NOFOLLOW adds a final-file guard.
function safeStat(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  let stat = fs.lstatSync(current);
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return { symlink: true };
  }
  return { stat };
}

function exclusion(relative) {
  const parts = relative.split('/');
  const base = parts.at(-1);
  if (parts.some(part => /^\.env/i.test(part) ||
      /^(?:\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|\.dockercfg|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.git-credentials)$/i.test(part) ||
      /(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?|keys?|private[._-]?keys?|api[._-]?keys?|service[._-]?accounts?)(?:$|[._-])/i.test(part) ||
      /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/i.test(part) ||
      /\.(?:pem|key|p12|pfx|keystore|jks|asc|gpg)$/i.test(part))) return 'sensitive-path';
  if (parts.slice(0, -1).some(part => EXCLUDED_DIRS.has(part))) return 'dependency-or-generated';
  if (LOCKS.has(base) || /(?:^|[.-])lock(?:\.json|\.yaml|\.toml)?$/i.test(base) || /^(?:Cargo.lock|Gemfile.lock|poetry.lock|uv.lock|Pipfile.lock|composer.lock)$/i.test(base)) return 'lockfile';
  if (/\.(?:min\.(?:js|css)|map)$/i.test(base)) return 'generated-file';
  if (BINARY_EXT.test(base)) return 'binary';
  return null;
}

function classify(relative, verification) {
  const base = path.posix.basename(relative);
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(relative) ||
      /^(?:\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.ya?ml|\.circleci\/config\.yml|\.buildkite\/[^/]+\.ya?ml)$/.test(relative)) verification.ciWorkflowPaths.push(relative);
  if (/^(?:eslint\.config\..+|\.eslintrc(?:\..+)?|biome\.jsonc?|\.stylelintrc(?:\..+)?|stylelint\.config\..+|ruff\.toml|\.ruff\.toml|\.pylintrc|\.golangci\.ya?ml)$/.test(base)) verification.lintConfigPaths.push(relative);
  if (/^(?:tsconfig(?:\.[^.]+)*\.json|jsconfig\.json|mypy\.ini|\.mypy\.ini|pyrightconfig\.json)$/.test(base)) verification.typeConfigPaths.push(relative);
}

function isTest(relative) {
  return /(?:^|\/)(?:__tests__|tests?|specs?)\/.*\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|php|c|cpp|cs)$/.test(relative) ||
    /(?:^|\/)(?:test_[^/]+\.py|[^/]+(?:[._-](?:test|spec))\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|php|c|cpp|cs))$/.test(relative);
}

function statusSummary(root) {
  const result = { changed: 0, staged: 0, unstaged: 0, deleted: 0, renamed: 0, unmerged: 0 };
  const entries = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=all']).split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const x = entry[0], y = entry[1];
    result.changed++;
    if (x !== ' ') result.staged++;
    if (y !== ' ') result.unstaged++;
    if (x === 'D' || y === 'D') result.deleted++;
    if (x === 'R' || y === 'R') result.renamed++;
    if (x === 'U' || y === 'U' || ['AA', 'DD'].includes(x + y)) result.unmerged++;
    if ('RC'.includes(x) || 'RC'.includes(y)) i++; // -z includes the source path separately
  }
  return result;
}

const SIGNAL_PATTERNS = [
  ['type-suppression', /@ts-(?:ignore|expect-error|nocheck)\b|\btype:\s*ignore\b|\b(?:mypy|pyright):\s*ignore\b/],
  ['lint-suppression', /\b(?:eslint-disable(?:-next-line|-line)?|stylelint-disable(?:-next-line|-line)?|noqa|nolint)\b|\b(?:pylint|ruff):\s*(?:disable|noqa)\b|\bbiome-ignore\b/],
  ['todo-fixme', /\b(?:TODO|FIXME)\b/],
];
function shellWord(value) {
  return /^[A-Za-z0-9_:@./-]+$/.test(value) && !value.startsWith('-') ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

// Windows can spell one directory with both long and 8.3 paths. Compare file IDs.
function sameDirectory(a, b) {
  const left = fs.statSync(a, { bigint: true });
  const right = fs.statSync(b, { bigint: true });
  return left.dev === right.dev && left.ino === right.ino;
}

export function inspect(rootInput) {
  const root = path.resolve(rootInput);
  let rootCheck;
  try { rootCheck = safeStat(root); } catch { throw new Error('Root is missing or unreadable'); }
  if (rootCheck.symlink) throw new Error('Root or an ancestor is a symlink; use its physical path');
  if (!rootCheck.stat.isDirectory()) throw new Error('Root must be a directory');
  let top, tracked;
  try {
    top = git(root, ['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '');
    if (!sameDirectory(root, top)) throw new Error('not-top-level');
    tracked = [...new Set(git(root, ['ls-files', '--cached', '-z']).split('\0').filter(Boolean))].sort();
  } catch (error) {
    if (error.message === 'not-top-level') throw new Error('--root must be the Git top-level, not a subdirectory');
    throw new Error('Cannot enumerate repository: Git is required, root must be a working tree, and Git output must fit 32 MiB');
  }
  const result = {
    schemaVersion: 1, scope: 'tracked-working-tree', root,
    summary: { trackedFiles: tracked.length, extensions: {}, testFiles: 0, gitStatus: null },
    packages: [],
    verification: { ciWorkflowPaths: [], lintConfigPaths: [], typeConfigPaths: [] },
    signals: { detected: 0, reported: 0, omitted: 0, limit: SIGNAL_LIMIT, byCategory: {}, items: [] },
    coverage: { scanned: 0, skipped: { total: 0, byReason: {} }, complete: true },
    warnings: [],
  };
  const skip = reason => {
    result.coverage.skipped.total++;
    result.coverage.skipped.byReason[reason] = (result.coverage.skipped.byReason[reason] || 0) + 1;
  };
  const warn = (relative, code) => result.warnings.push({ path: relative, code });
  const manifests = new Map(), lockManagers = new Map();
  let bytesRead = 0;
  for (const relative of tracked) {
    const ext = path.posix.extname(relative).toLowerCase() || '(extensionless)';
    Object.defineProperty(result.summary.extensions, ext, { value: (result.summary.extensions[ext] || 0) + 1, enumerable: true, configurable: true, writable: true });
    if (isTest(relative)) result.summary.testFiles++;
    const absolute = path.resolve(root, relative);
    if (path.relative(root, absolute).startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split('/').includes('..')) {
      skip('unsafe-path'); warn(relative, 'unsafe-path'); continue;
    }
    // Exclude sensitive/generated paths without opening or statting their contents.
    const reason = exclusion(relative);
    if (reason && reason !== 'lockfile') { skip(reason); continue; }
    let stat;
    try {
      const check = safeStat(absolute);
      if (check.symlink) { skip('symlink'); continue; }
      stat = check.stat;
    } catch { skip('unreadable-or-missing'); warn(relative, 'unreadable-or-missing'); continue; }
    if (!stat.isFile()) { skip('non-regular-file'); continue; }
    if (reason === 'lockfile') {
      const manager = LOCKS.get(path.posix.basename(relative));
      if (manager) {
        const dir = path.posix.dirname(relative);
        const managers = lockManagers.get(dir) || [];
        managers.push({ manager, path: relative }); lockManagers.set(dir, managers);
      }
      skip(reason); continue;
    }
    if (stat.size > MAX_FILE_BYTES) { skip('file-too-large'); continue; }
    if (result.coverage.scanned >= MAX_SCAN_FILES || bytesRead + stat.size > MAX_TOTAL_BYTES) { skip('scan-budget'); continue; }
    let text, fd;
    try {
      fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      // Bound the actual read too, in case the file grows after lstat.
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1));
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      bytesRead += size;
      if (size > MAX_FILE_BYTES || size > stat.size) { skip('changed-during-read'); warn(relative, 'changed-during-read'); continue; }
      const content = buffer.subarray(0, size);
      if (content.includes(0)) { skip('binary'); continue; }
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
      catch { skip('non-utf8'); continue; }
    } catch { skip('unreadable-or-missing'); warn(relative, 'unreadable-or-missing'); continue; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    result.coverage.scanned++;
    classify(relative, result.verification);
    if (path.posix.basename(relative) === 'package.json') {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        const manager = typeof parsed.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(parsed.packageManager)?.[1] : undefined;
        const scripts = parsed.scripts && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)
          ? Object.keys(parsed.scripts).filter(name => typeof parsed.scripts[name] === 'string').sort() : [];
        manifests.set(path.posix.dirname(relative), { manager, scripts });
      } catch { warn(relative, 'invalid-package-json'); }
    }
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const [category, pattern] of SIGNAL_PATTERNS) {
        if (!pattern.test(line)) continue;
        result.signals.detected++;
        result.signals.byCategory[category] = (result.signals.byCategory[category] || 0) + 1;
        if (result.signals.items.length < SIGNAL_LIMIT) result.signals.items.push({ path: relative, line: index + 1, category });
      }
    }
  }
  for (const [directory, manifest] of manifests) {
    let current = directory, manager = null, source = null;
    while (true) {
      if (manifests.get(current)?.manager) { manager = manifests.get(current).manager; source = path.posix.join(current, 'package.json'); break; }
      const locks = lockManagers.get(current) || [];
      const managers = [...new Set(locks.map(lock => lock.manager))];
      if (managers.length === 1) { manager = managers[0]; source = locks[0].path; break; }
      if (managers.length > 1) { warn(directory, 'ambiguous-package-manager'); break; }
      if (current === '.') break;
      current = path.posix.dirname(current);
    }
    result.packages.push({ directory, packageManager: manager, packageManagerSource: source,
      scripts: manifest.scripts.map(name => ({ name, suggestedInvocation: manager ? `${manager} run ${shellWord(name)}` : null })) });
  }
  try { result.summary.gitStatus = statusSummary(root); }
  catch { warn('.', 'git-status-unavailable'); }
  result.signals.reported = result.signals.items.length;
  result.signals.omitted = result.signals.detected - result.signals.reported;
  result.coverage.complete = result.coverage.skipped.total === 0 && result.warnings.length === 0;
  return result;
}

export function humanReport(result) {
  const lines = [
    'Repository inventory (advisory, not an audit)',
    `Root: ${JSON.stringify(result.root)}`,
    `Scope: ${result.scope}; ${result.summary.trackedFiles} tracked paths; ${result.coverage.scanned} text files scanned`,
    `Extensions: ${JSON.stringify(result.summary.extensions)}`,
    `Test files (path heuristic): ${result.summary.testFiles}`,
    `Tracked Git status (submodule changes ignored): ${JSON.stringify(result.summary.gitStatus)}`,
    `Packages: ${result.packages.length}; run suggestions from each package directory`,
  ];
  for (const pkg of result.packages) {
    lines.push(`  ${JSON.stringify(pkg.directory)} (${pkg.packageManager || 'manager unknown'})`);
    for (const script of pkg.scripts) lines.push(`    ${JSON.stringify(script.name)}: ${JSON.stringify(script.suggestedInvocation)}`);
  }
  for (const [kind, paths] of Object.entries(result.verification)) lines.push(`${kind}: ${JSON.stringify(paths)}`);
  lines.push(`Signals: ${result.signals.detected} detected, ${result.signals.reported} shown, ${result.signals.omitted} omitted (one per line/category)`);
  for (const signal of result.signals.items) lines.push(`  ${JSON.stringify(signal.path)}:${signal.line} ${signal.category}`);
  lines.push(`Skipped: ${result.coverage.skipped.total} ${JSON.stringify(result.coverage.skipped.byReason)}`,
    `Coverage: ${result.coverage.complete ? 'complete within stated detection limits' : 'incomplete; review exclusions and warnings'}`,
    `Warnings: ${JSON.stringify(result.warnings)}`);
  return lines.join('\n');
}

export function main(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
    let root, json = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--root' && root === undefined && args[i + 1] && !args[i + 1].startsWith('--')) root = args[++i];
      else if (args[i] === '--json' && !json) json = true;
      else throw new Error('Invalid arguments; use --help');
    }
    if (!root) throw new Error('--root is required; use --help');
    const result = inspect(root);
    console.log(json ? JSON.stringify(result, null, 2) : humanReport(result));
    return 0;
  } catch (error) { console.error(`inspect: ${error.message}`); return 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
