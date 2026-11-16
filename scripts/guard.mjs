#!/usr/bin/env node
// A literal-text check, deliberately not a parser or architecture analyzer.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.output', '.cache', '.turbo', 'generated', '__generated__']);
const HELP = `Usage: node /skill/scripts/guard.mjs --root /repo [--config .steward.json] [--json]
       node /skill/scripts/guard.mjs --help

Requires Node >=22 and Git. Default config: .steward.json, relative to root.
Root must be the Git working-tree root. Config must stay inside root.
Config schema (unknown keys rejected):
{"version":1,"rules":[{"id":"no-legacy-client","files":["src/**/*.ts"],"exclude":["src/legacy/**"],"forbid":["@app/legacy-client"],"message":"Use @app/client instead"}]}

Rules must be nonempty; IDs are unique lowercase words separated by hyphens.
files and forbid must be nonempty arrays; exclude is optional. Tokens are
nonempty, single-line, case-sensitive literal substrings, not regular expressions.
Globs are root-relative portable paths: *, ?, and whole-segment ** only.
** matches zero or more directories: src/**/*.ts includes src/a.ts.
No braces, brackets, extglobs, backslashes, absolute paths, or . / .. segments.

Scope: tracked-working-tree, including dirty contents, never index/commit contents.
Untracked files (including ignored files) are excluded, with a warning on stderr.
Globally skipped directories: ${[...SKIP_DIRS].join(', ')}.
Every rule must select at least one tracked eligible file after exclusions.
Matching missing/deleted, unreadable, symlinked (including ancestors), nonregular,
binary/non-UTF-8, or >1 MiB files make the result incomplete, never a pass.
Secret paths are not read: .env*; keys / keys.*; .ssh; id_rsa/id_dsa/id_ecdsa/
id_ed25519 (including extensions); .key/.pem/.p12/.pfx/.keystore files.

Comments and strings count. One finding per rule/file/line/distinct token;
repeated occurrences on a line count once. Findings contain only file, line,
ruleId, message: no tokens or source snippets (two tokens can yield identical
finding objects). scannedFiles counts unique successfully scanned files.
JSON: schemaVersion=1, status=pass|fail|incomplete, scannedFiles, findings,
errors (strings), scope=tracked-working-tree. Warnings go to stderr.
Exit 0: complete, no matches; 1: complete with matches; 2: invalid input or
incomplete scan, taking precedence over matches. --help exits 0.

No baseline, autoinit, edits, network, project code execution, or dependencies.
Only Git read commands are run; no project hooks or fsmonitor are invoked.
This is a small literal-text guard, NOT architecture static analysis or a
substitute for lint/AST checks. It does not resolve imports or infer dependencies.
Run on a stable trusted working tree, not as a filesystem security sandbox.
`;

function fail(message) { throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} contains unknown keys`);
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function globRegex(glob) {
  if (!nonempty(glob) || glob.startsWith('/') || /[\\\[\]{}<>:"|\x00-\x1f\x7f]/.test(glob) || /[?*+@!]\(/.test(glob)) {
    fail('Invalid glob: use relative portable paths with only *, **, and ? wildcards');
  }
  const parts = glob.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || (p.includes('**') && p !== '**'))) {
    fail('Invalid glob: empty, dot, parent, or partial ** path segments are not supported');
  }
  let source = '^';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '**') source += i === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
    else {
      for (const ch of part) source += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (i < parts.length - 1) source += '/';
    }
  }
  return new RegExp(source + '$', 'u');
}
function validateConfig(config) {
  exactKeys(config, ['version', 'rules'], 'Config');
  if (config.version !== 1) fail('Config version must be 1');
  if (!Array.isArray(config.rules) || !config.rules.length) fail('Config rules must be a nonempty array');
  const ids = new Set();
  return config.rules.map((rule, index) => {
    const label = `Rule ${index + 1}`;
    exactKeys(rule, ['id', 'files', 'exclude', 'forbid', 'message'], label);
    if (typeof rule.id !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(rule.id)) fail(`${label} id must use lowercase words separated by hyphens`);
    if (ids.has(rule.id)) fail(`Duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
    if (!Array.isArray(rule.files) || !rule.files.length) fail(`${label} files must be a nonempty array`);
    if ('exclude' in rule && !Array.isArray(rule.exclude)) fail(`${label} exclude must be an array`);
    if (!Array.isArray(rule.forbid) || !rule.forbid.length || rule.forbid.some(t => typeof t !== 'string' || t.length === 0 || /[\r\n\u2028\u2029\x00]/.test(t))) fail(`${label} forbid must contain nonempty single-line strings`);
    if (!nonempty(rule.message)) fail(`${label} message must be nonempty`);
    return { ...rule, includes: rule.files.map(globRegex), excludes: (rule.exclude ?? []).map(globRegex), tokens: [...new Set(rule.forbid)] };
  });
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function noSymlinks(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) fail('Symlink path or ancestor is not allowed');
  }
}
function safeRead(absolute, limit) {
  noSymlinks(absolute);
  const before = fs.lstatSync(absolute);
  if (!before.isFile()) fail('Not a regular file');
  if ((before.mode & 0o444) === 0) fail('File is unreadable');
  if (before.size > limit) fail('File exceeds 1 MiB');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino) fail('File changed during scan');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) fail('File exceeds 1 MiB');
    return buffer.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function text(buffer) {
  if (buffer.some(b => b < 9 || b === 11 || (b > 13 && b < 32) || b === 127)) fail('Binary file is not scannable');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { fail('Non-UTF-8 file is not scannable'); }
}
function secret(file) {
  return file.split('/').some(part => /^\.env/i.test(part) || /^(keys(?:\.|$)|\.ssh$|id_(rsa|dsa|ecdsa|ed25519)(?:\.|$))/i.test(part) || /\.(key|pem|p12|pfx|keystore)$/i.test(part));
}
function git(root, args) {
  // Ignore environment overrides that could silently inspect a different repository.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|EXEC_PATH)$/.test(key)) delete env[key];
  try { return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { fail('Git read failed; verify Git is installed and root is a readable working-tree repository'); }
}
function args(argv) {
  const options = { config: '.steward.json', json: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!['--root', '--config', '--json', '--help'].includes(arg)) fail('Unknown argument; use --help for exact syntax');
    if (seen.has(arg)) fail('Duplicate argument; use each option once');
    seen.add(arg);
    if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail('Missing option value; use --help for exact syntax');
      options[arg.slice(2)] = value;
    }
  }
  if (!options.help && !options.root) fail('--root is required');
  return options;
}
function describe(error) {
  // Native error text may contain paths or parser excerpts; never print it.
  if (error.code) return ({ ENOENT: 'Tracked file/path is missing or deleted', EACCES: 'File/path is unreadable', EPERM: 'File/path access denied', ELOOP: 'Symlink path is not allowed', ENOTDIR: 'Path ancestor is not a directory' })[error.code] ?? 'File/path could not be read';
  return error.message;
}

const result = { schemaVersion: 1, status: 'pass', scannedFiles: 0, findings: [], errors: [], scope: 'tracked-working-tree' };
let json = process.argv.slice(2).includes('--json');
try {
  const options = args(process.argv.slice(2));
  json = options.json;
  if (options.help) { process.stdout.write(HELP); process.exit(0); }
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node >=22 is required');
  const root = path.resolve(options.root);
  noSymlinks(root);
  if (!fs.statSync(root).isDirectory()) fail('Root must be a directory');
  const gitRoot = text(git(root, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
  if (path.resolve(gitRoot) !== root) fail('--root must be the Git working-tree root');
  const configPath = path.resolve(root, options.config);
  if (!inside(root, configPath)) fail('Config path must stay inside root');
  let config;
  const configText = text(safeRead(configPath, MAX_BYTES));
  try { config = JSON.parse(configText); } catch { fail('Config must be valid JSON'); }
  const rules = validateConfig(config);
  const tracked = [...new Set(new TextDecoder('utf-8', { fatal: true }).decode(git(root, ['ls-files', '--cached', '-z'])).split('\0').filter(Boolean))].sort();
  process.stderr.write('Warning: untracked files, including ignored files, are excluded; only tracked working-tree files are scanned\n');
  const selections = new Map(rules.map(rule => [rule.id, 0]));
  for (const file of tracked) {
    const parts = file.split('/');
    if (parts.slice(0, -1).some(part => SKIP_DIRS.has(part))) continue;
    const selected = rules.filter(rule => rule.includes.some(re => re.test(file)) && !rule.excludes.some(re => re.test(file)));
    if (!selected.length) continue;
    try {
      const absolute = path.resolve(root, file);
      if (!inside(root, absolute) || parts.some(p => p === '..' || p === '.')) fail('Tracked path is outside root');
      if (secret(file)) fail('Secret path is not read; narrow files or explicitly exclude it');
      const contents = text(safeRead(absolute, MAX_BYTES));
      result.scannedFiles++;
      const lines = contents.split(/\r\n|[\n\r\u2028\u2029]/);
      for (const rule of selected) {
        selections.set(rule.id, selections.get(rule.id) + 1);
        for (let index = 0; index < lines.length; index++) {
          for (const token of rule.tokens) if (lines[index].includes(token)) result.findings.push({ file, line: index + 1, ruleId: rule.id, message: rule.message });
        }
      }
    } catch (error) { result.errors.push(`${JSON.stringify(file)}: ${describe(error)}`); }
  }
  for (const rule of rules) if (!selections.get(rule.id)) result.errors.push(`Rule ${rule.id} selected no tracked eligible files; check files/exclude globs and tracked paths`);
} catch (error) { result.errors.push(describe(error)); }
result.status = result.errors.length ? 'incomplete' : result.findings.length ? 'fail' : 'pass';
if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
else {
  process.stdout.write(`${result.status.toUpperCase()}: ${result.scannedFiles} tracked working-tree files scanned, ${result.findings.length} findings\n`);
  for (const finding of result.findings) process.stdout.write(`${JSON.stringify(finding.file)}:${finding.line} [${finding.ruleId}] ${JSON.stringify(finding.message)}\n`);
  for (const error of result.errors) process.stdout.write(`ERROR: ${error}\n`);
}
process.exitCode = result.status === 'incomplete' ? 2 : result.status === 'fail' ? 1 : 0;
