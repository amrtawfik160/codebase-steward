import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspect } from '../scripts/inspect.mjs';

const cli = fileURLToPath(new URL('../scripts/inspect.mjs', import.meta.url));
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inventory fixture ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  return root;
}
function put(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function track(root) { git(root, 'add', '-f', '--all'); }
function run(root, ...args) {
  return spawnSync(process.execPath, [cli, '--root', root, ...args], { encoding: 'utf8' });
}
function json(root) {
  const out = run(root, '--json');
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test('tracked working-tree inventory handles spaces, dirty files, extensionless paths and no snippets', t => {
  const root = fixture(t);
  put(root, 'src with spaces/main.ts', 'const initial = 1\n');
  put(root, 'README', 'Project\n');
  put(root, '.gitignore', 'ignored.txt\n');
  track(root);
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  put(root, 'src with spaces/main.ts', '// TODO private source must not appear\n// @ts-ignore\n// eslint-disable-next-line\n');
  put(root, 'untracked.ts', '// FIXME\n');
  put(root, 'ignored.txt', '// FIXME\n');
  const data = json(root);
  assert.equal(data.scope, 'tracked-working-tree');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.root, root);
  assert.equal(data.summary.trackedFiles, 3);
  assert.equal(data.summary.extensions['(extensionless)'], 2);
  assert.equal(data.summary.gitStatus.unstaged, 1);
  assert.equal(data.signals.detected, 3);
  assert.deepEqual(data.signals.items.map(s => s.line), [1, 2, 3]);
  assert.equal(data.signals.items[0].path, 'src with spaces/main.ts');
  assert.equal(JSON.stringify(data).includes('private source'), false);
  assert.deepEqual(Object.keys(data), ['schemaVersion', 'scope', 'root', 'summary', 'packages', 'verification', 'signals', 'coverage', 'warnings']);
});

test('nested package managers use nearest metadata and scripts are never executed or disclosed', t => {
  const root = fixture(t);
  put(root, 'package.json', JSON.stringify({ packageManager: 'pnpm@9.0.0', scripts: { test: `touch '${path.join(root, 'SENTINEL')}'; echo SECRET_BODY_VALUE` } }));
  put(root, 'apps/one/package.json', JSON.stringify({ scripts: { build: 'echo PRIVATE_BUILD_BODY' } }));
  put(root, 'apps/two/package.json', JSON.stringify({ packageManager: 'bun@1.0.0', scripts: { test: 'exit 99' } }));
  put(root, 'apps/three/package.json', JSON.stringify({ scripts: { test: 'exit 99' } }));
  put(root, 'apps/three/yarn.lock', 'LOCK_SECRET_CONTENT TODO');
  put(root, '.github/workflows/ci.yml', 'name: CI\n');
  put(root, 'eslint.config.mjs', 'export default []\n');
  put(root, 'apps/one/tsconfig.build.json', '{}');
  put(root, 'tests/a.test.js', '');
  track(root);
  const data = json(root), packages = new Map(data.packages.map(p => [p.directory, p]));
  assert.equal(packages.get('.').scripts[0].suggestedInvocation, 'pnpm run test');
  assert.equal(packages.get('apps/one').packageManager, 'pnpm');
  assert.equal(packages.get('apps/two').packageManager, 'bun');
  assert.equal(packages.get('apps/three').packageManager, 'yarn');
  assert.equal(fs.existsSync(path.join(root, 'SENTINEL')), false);
  assert.equal(JSON.stringify(data).includes('SECRET_BODY_VALUE'), false);
  assert.equal(JSON.stringify(data).includes('PRIVATE_BUILD_BODY'), false);
  assert.equal(data.signals.detected, 0);
  assert.equal(data.coverage.skipped.byReason.lockfile, 1);
  assert.deepEqual(data.verification.ciWorkflowPaths, ['.github/workflows/ci.yml']);
  assert.deepEqual(data.verification.lintConfigPaths, ['eslint.config.mjs']);
  assert.deepEqual(data.verification.typeConfigPaths, ['apps/one/tsconfig.build.json']);
  assert.equal(data.summary.testFiles, 1);
});

test('npm lockfile metadata yields npm invocation; unknown managers remain unknown', t => {
  const root = fixture(t);
  put(root, 'known/package.json', '{"scripts":{"test":"exit 1"}}');
  put(root, 'known/package-lock.json', '{}');
  put(root, 'unknown/package.json', '{"scripts":{"test":"exit 1"}}');
  track(root);
  const data = inspect(root);
  assert.equal(data.packages[0].scripts[0].suggestedInvocation, 'npm run test');
  assert.equal(data.packages[1].packageManager, null);
  assert.equal(data.packages[1].scripts[0].suggestedInvocation, null);
});

test('refuses tracked symlinks and ancestor symlink directories', t => {
  const root = fixture(t);
  put(root, 'outside/real.txt', '// TODO outside\n');
  put(root, 'nested/code.ts', '// TODO initial\n');
  try { fs.symlinkSync('outside/real.txt', path.join(root, 'link.ts')); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Symlink creation requires Windows privileges');
    throw error;
  }
  track(root);
  fs.rmSync(path.join(root, 'nested'), { recursive: true });
  fs.symlinkSync('outside', path.join(root, 'nested'), 'dir');
  put(root, 'outside/code.ts', '// TODO must not read\n');
  const data = json(root);
  assert.equal(data.coverage.skipped.byReason.symlink, 2);
  assert.equal(data.signals.detected, 1);
  assert.equal(data.coverage.complete, false);
  assert.equal(data.signals.items.some(s => s.path === 'link.ts' || s.path === 'nested/code.ts'), false);
  const alias = `${root}-alias`;
  fs.symlinkSync(root, alias, 'dir');
  t.after(() => fs.rmSync(alias, { force: true }));
  assert.equal(run(alias, '--json').status, 2);
});

test('invalid package JSON and missing tracked files warn without leaking source', t => {
  const root = fixture(t);
  put(root, 'package.json', '{ INVALID_PRIVATE_VALUE');
  put(root, 'deleted.txt', '');
  track(root);
  fs.unlinkSync(path.join(root, 'deleted.txt'));
  const data = json(root);
  assert.equal(data.coverage.complete, false);
  assert.ok(data.warnings.some(w => w.code === 'invalid-package-json'));
  assert.ok(data.warnings.some(w => w.code === 'unreadable-or-missing'));
  assert.equal(data.summary.gitStatus.deleted, 1);
  assert.equal(JSON.stringify(data).includes('INVALID_PRIVATE_VALUE'), false);
});

test('secret-looking, generated, dependency, binary, non-UTF8 and oversized files are omitted', t => {
  const root = fixture(t);
  for (const name of ['.env', '.env.local', '.env-example', '.envrc', 'deploy/credentials.json', 'private-key.txt', 'keys.json', '.ssh/config', 'server.pem', '.npmrc', 'id_ed25519']) put(root, name, 'TODO TOP_SECRET');
  for (const name of ['node_modules/p/index.js', 'dist/index.js', 'src/generated/file.ts', 'app.min.js']) put(root, name, 'TODO GENERATED');
  put(root, 'large.txt', 'x'.repeat(1024 * 1024 + 1));
  put(root, 'unknown-file', Buffer.from([0, 42]));
  put(root, 'invalid-utf8', Buffer.from([0xff, 0xfe]));
  put(root, 'photo.png', 'TODO');
  put(root, 'safe.ts', '// TODO safe\n');
  track(root);
  const data = json(root);
  assert.equal(data.coverage.scanned, 1);
  assert.equal(data.coverage.skipped.total, data.summary.trackedFiles - 1);
  assert.equal(data.coverage.skipped.byReason['sensitive-path'], 11);
  assert.equal(data.coverage.skipped.byReason['file-too-large'], 1);
  assert.equal(data.coverage.skipped.byReason.binary, 2);
  assert.equal(data.coverage.skipped.byReason['non-utf8'], 1);
  assert.equal(data.signals.detected, 1);
  assert.equal(JSON.stringify(data).includes('TOP_SECRET'), false);
});

test('signals are capped but full per-line/category totals retained', t => {
  const root = fixture(t);
  put(root, 'code.ts', '// TODO FIXME @ts-ignore eslint-disable\n'.repeat(25));
  track(root);
  const data = json(root);
  assert.equal(data.signals.detected, 75);
  assert.equal(data.signals.reported, 50);
  assert.equal(data.signals.omitted, 25);
  assert.equal(data.signals.items.length, 50);
  assert.deepEqual(data.signals.byCategory, { 'type-suppression': 25, 'lint-suppression': 25, 'todo-fixme': 25 });
});

test('invalid flags, absent roots, non-Git roots and subdirectories exit 2', t => {
  const root = fixture(t);
  for (const args of [[], ['--root'], ['--json'], ['--wat'], ['--help', '--json'], ['--root', root, '--json', '--json'], ['--root', root, '--root', root], ['--root', root, 'extra']]) {
    const out = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(out.status, 2, JSON.stringify(args));
    assert.equal(out.stdout, '');
  }
  fs.mkdirSync(path.join(root, 'sub'));
  assert.equal(run(path.join(root, 'sub')).status, 2);
  assert.equal(run(path.join(root, 'missing')).status, 2);
  const nonGit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'not-git-')));
  t.after(() => fs.rmSync(nonGit, { recursive: true, force: true }));
  assert.equal(run(nonGit).status, 2);
});

test('help documents limits, human output is advisory, JSON is deterministic and no files change', t => {
  const root = fixture(t);
  put(root, 'README.md', 'Hello');
  track(root);
  const before = git(root, 'status', '--porcelain=v1', '-z');
  const indexBefore = fs.readFileSync(path.join(root, '.git/index'));
  const out = run(root);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /advisory, not an audit/);
  assert.doesNotMatch(out.stdout, /score|clean bill/);
  assert.equal(run(root, '--json').stdout, run(root, '--json').stdout);
  assert.equal(git(root, 'status', '--porcelain=v1', '-z'), before);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), indexBefore);
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  for (const expected of ['1 MiB', '64 MiB', '10,000', '50 signal', 'exit 2', 'symlink', 'not a secret detector']) assert.ok(help.stdout.includes(expected), expected);
});

test('Windows drive-letter case does not change repository identity', { skip: process.platform !== 'win32' }, t => {
  const root = fixture(t); put(root, 'src/a.js', 'export const a = 1'); track(root);
  const alternate = root[0] === root[0].toUpperCase() ? root[0].toLowerCase() + root.slice(1) : root[0].toUpperCase() + root.slice(1);
  const out = run(alternate, '--json');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).summary.trackedFiles, 1);
});
