import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url));
const baseRule = () => ({ id: 'no-legacy-client', files: ['src/**/*.ts'], exclude: ['src/legacy/**'], forbid: ['@app/legacy-client'], message: 'Use @app/client instead' });
function repo(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'literal-guard-')));
  t.after(() => { fs.chmodSync(root, 0o700); fs.rmSync(root, { recursive: true, force: true }); });
  execFileSync('git', ['init', '-q', root]);
  const write = (file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  const add = (...files) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'add', '--', ...files]);
  const config = (rules = [baseRule()]) => write('.steward.json', JSON.stringify({ version: 1, rules }));
  const run = (extra = [], raw = false) => {
    const proc = spawnSync(process.execPath, [script, '--root', root, ...extra, ...(raw ? [] : ['--json'])], { encoding: 'utf8' });
    assert.equal(proc.error, undefined);
    return { ...proc, data: raw ? undefined : JSON.parse(proc.stdout) };
  };
  write('src/a.ts', 'import client from "@app/client";\n'); add('src/a.ts'); config();
  return { root, write, add, config, run };
}
function symlink(t, target, destination, type = 'file') {
  try { fs.symlinkSync(target, destination, type); return true; }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows symlink privilege is unavailable'); return false; }
    throw error;
  }
}
function status(output, code, name) {
  assert.equal(output.status, code, output.stdout + output.stderr);
  assert.equal(output.data.status, name);
  assert.equal(output.data.schemaVersion, 1);
  assert.equal(output.data.scope, 'tracked-working-tree');
  assert.deepEqual(Object.keys(output.data).sort(), ['errors', 'findings', 'scannedFiles', 'schemaVersion', 'scope', 'status']);
}

test('passes clean tracked working tree without any commits; ** includes root-level TS', t => {
  const r = repo(t); const out = r.run(); status(out, 0, 'pass'); assert.equal(out.data.scannedFiles, 1);
  assert.deepEqual(out.data.findings, []); assert.deepEqual(out.data.errors, []);
});
test('findings use only four fields and contain actionable message, not token or source', t => {
  const r = repo(t); r.write('src/a.ts', 'const privateValue = "@app/legacy-client";\n');
  const out = r.run(); status(out, 1, 'fail');
  assert.deepEqual(out.data.findings, [{ file: 'src/a.ts', line: 1, ruleId: 'no-legacy-client', message: 'Use @app/client instead' }]);
  assert.ok(!out.stdout.includes('@app/legacy-client')); assert.ok(!out.stdout.includes('privateValue'));
  const human = r.run([], true); assert.equal(human.status, 1); assert.match(human.stdout, /Use @app\/client instead/);
});
test('excluded legacy wrapper does not trigger findings', t => {
  const r = repo(t); r.write('src/legacy/wrapper.ts', '@app/legacy-client'); r.add('src/legacy/wrapper.ts');
  const out = r.run(); status(out, 0, 'pass'); assert.equal(out.data.scannedFiles, 1);
});
test('matches nested files and filenames with spaces', t => {
  const r = repo(t); r.write('src/a folder/with spaces.ts', '@app/legacy-client'); r.add('src/a folder/with spaces.ts');
  const out = r.run(); status(out, 1, 'fail'); assert.equal(out.data.scannedFiles, 2); assert.equal(out.data.findings[0].file, 'src/a folder/with spaces.ts');
});
test('literal regex punctuation and case-sensitive tokens', t => {
  const r = repo(t); r.config([{ ...baseRule(), forbid: ['a.b+$[x](?)'] }]);
  r.write('src/a.ts', 'axbZZx\nA.b+$[x](?)\na.b+$[x](?)\n');
  const out = r.run(); status(out, 1, 'fail'); assert.equal(out.data.findings.length, 1); assert.equal(out.data.findings[0].line, 3);
});
test('comments and strings count; repeated same token on a line counts once', t => {
  const r = repo(t); r.write('src/a.ts', '// @app/legacy-client @app/legacy-client\r\nconst x = "@app/legacy-client";');
  const out = r.run(); status(out, 1, 'fail'); assert.deepEqual(out.data.findings.map(f => f.line), [1, 2]);
});
test('one finding per distinct token per line, without leaking tokens', t => {
  const r = repo(t); r.config([{ ...baseRule(), forbid: ['first-secret', 'second-secret', 'first-secret'] }]); r.write('src/a.ts', 'first-secret second-secret first-secret');
  const out = r.run(); status(out, 1, 'fail'); assert.equal(out.data.findings.length, 2); assert.ok(!out.stdout.includes('first-secret'));
});
test('every rule must select files, even when another rule passes', t => {
  const r = repo(t); r.config([baseRule(), { ...baseRule(), id: 'typo-rule', files: ['scr/**/*.ts'] }]);
  const out = r.run(); status(out, 2, 'incomplete'); assert.match(out.data.errors.join(' '), /typo-rule selected no tracked eligible files/);
});
test('all excluded files are an incomplete empty selection', t => {
  const r = repo(t); r.config([{ ...baseRule(), exclude: ['src/**'] }]); status(r.run(), 2, 'incomplete');
});
test('question and single-star globs match only one path segment', t => {
  const r = repo(t); r.write('src/nested/a.ts', '@app/legacy-client'); r.add('src/nested/a.ts'); r.config([{ ...baseRule(), files: ['src/?.ts'] }]);
  const out = r.run(); status(out, 0, 'pass'); assert.equal(out.data.scannedFiles, 1);
  r.config([{ ...baseRule(), files: ['src/*.ts'] }]); status(r.run(), 0, 'pass');
});
for (const glob of ['../*.ts', '/src/*.ts', 'C:/src/*.ts', 'src/../a.ts', 'src/{a,b}.ts', 'src/[ab].ts', 'src/@(a).ts', 'src/**a.ts', 'src/***/a.ts', 'src\\a.ts', 'src//a.ts', './src/*.ts']) {
  test(`rejects unsupported or unsafe glob ${JSON.stringify(glob)}`, t => {
    const r = repo(t); r.config([{ ...baseRule(), files: [glob] }]); status(r.run(), 2, 'incomplete');
  });
}
for (const [label, value] of [
  ['empty rules', { version: 1, rules: [] }],
  ['unknown top-level key', { version: 1, rules: [baseRule()], baseline: [] }],
  ['unknown rule key', { version: 1, rules: [{ ...baseRule(), severity: 'warn' }] }],
  ['duplicate IDs', { version: 1, rules: [baseRule(), baseRule()] }],
  ['invalid ID', { version: 1, rules: [{ ...baseRule(), id: 'Upper_Case' }] }],
  ['wrong version', { version: 2, rules: [baseRule()] }],
  ['missing files', { version: 1, rules: [{ id: 'rule', forbid: ['token'], message: 'Fix it' }] }],
  ['empty files', { version: 1, rules: [{ ...baseRule(), files: [] }] }],
  ['empty forbid', { version: 1, rules: [{ ...baseRule(), forbid: [] }] }],
  ['empty token', { version: 1, rules: [{ ...baseRule(), forbid: [''] }] }],
  ['multiline token', { version: 1, rules: [{ ...baseRule(), forbid: ['a\nb'] }] }],
  ['nonstring token', { version: 1, rules: [{ ...baseRule(), forbid: [9] }] }],
  ['empty message', { version: 1, rules: [{ ...baseRule(), message: '' }] }],
  ['wrong exclude', { version: 1, rules: [{ ...baseRule(), exclude: 'src/**' }] }],
]) {
  test(`rejects ${label}`, t => { const r = repo(t); r.write('.steward.json', JSON.stringify(value)); status(r.run(), 2, 'incomplete'); });
}
test('malformed JSON does not expose config contents', t => {
  const r = repo(t); r.write('.steward.json', '{ secret-do-not-print'); const out = r.run(); status(out, 2, 'incomplete'); assert.ok(!out.stdout.includes('secret-do-not-print'));
});
test('unknown flags and missing values return structured incomplete results', t => {
  const r = repo(t); status(r.run(['--wat']), 2, 'incomplete'); status(r.run(['--config']), 2, 'incomplete'); status(r.run(['--root', r.root]), 2, 'incomplete');
});
test('config traversal outside root rejected', t => { const r = repo(t); status(r.run(['--config', '../outside.json']), 2, 'incomplete'); });
test('custom config inside root works', t => {
  const r = repo(t); r.write('config/rules.json', JSON.stringify({ version: 1, rules: [baseRule()] })); status(r.run(['--config', 'config/rules.json']), 0, 'pass');
});
test('symlink config and config ancestor rejected', t => {
  const r = repo(t); if (!symlink(t, '.steward.json', path.join(r.root, 'alias.json'))) return; status(r.run(['--config', 'alias.json']), 2, 'incomplete');
  fs.mkdirSync(path.join(r.root, 'config')); r.write('config/rules.json', JSON.stringify({ version: 1, rules: [baseRule()] })); if (!symlink(t, 'config', path.join(r.root, 'config-link'), 'dir')) return; status(r.run(['--config', 'config-link/rules.json']), 2, 'incomplete');
});
test('tracked deleted file makes scan incomplete', t => { const r = repo(t); fs.unlinkSync(path.join(r.root, 'src/a.ts')); status(r.run(), 2, 'incomplete'); });
test('tracked symlink makes scan incomplete', t => {
  const r = repo(t); r.write('actual.ts', 'clean'); if (!symlink(t, '../actual.ts', path.join(r.root, 'src/link.ts'))) return; r.add('src/link.ts'); status(r.run(), 2, 'incomplete');
});
test('symlink ancestor of originally tracked file makes scan incomplete', t => {
  const r = repo(t); fs.renameSync(path.join(r.root, 'src'), path.join(r.root, 'actual')); if (!symlink(t, 'actual', path.join(r.root, 'src'), 'dir')) return; status(r.run(), 2, 'incomplete');
});
test('unreadable matched file makes scan incomplete', { skip: process.platform === 'win32' ? 'Windows chmod does not implement POSIX read permission bits' : false }, t => {
  const r = repo(t); fs.chmodSync(path.join(r.root, 'src/a.ts'), 0o000); const out = r.run(); fs.chmodSync(path.join(r.root, 'src/a.ts'), 0o600); status(out, 2, 'incomplete');
});
test('binary or invalid UTF-8 matched file makes scan incomplete', t => {
  const r = repo(t); r.write('src/a.ts', Buffer.from([65, 0, 66])); status(r.run(), 2, 'incomplete');
  r.write('src/a.ts', Buffer.from([0xff, 0xfe])); status(r.run(), 2, 'incomplete');
});
test('size limit permits exactly 1 MiB, rejects above it', t => {
  const r = repo(t); r.write('src/a.ts', 'x'.repeat(1024 * 1024)); status(r.run(), 0, 'pass'); r.write('src/a.ts', 'x'.repeat(1024 * 1024 + 1)); status(r.run(), 2, 'incomplete');
});
test('incomplete scan takes precedence over discovered violations', t => {
  const r = repo(t); r.write('src/a.ts', '@app/legacy-client'); r.write('src/b.ts', 'clean'); r.add('src/b.ts'); fs.unlinkSync(path.join(r.root, 'src/b.ts'));
  const out = r.run(); status(out, 2, 'incomplete'); assert.equal(out.data.findings.length, 1);
});
test('dirty working-tree contents are scanned instead of index', t => {
  const r = repo(t); r.write('src/a.ts', '@app/legacy-client'); r.add('src/a.ts'); r.write('src/a.ts', 'clean'); status(r.run(), 0, 'pass');
  r.add('src/a.ts'); r.write('src/a.ts', '@app/legacy-client'); status(r.run(), 1, 'fail');
});
test('untracked and ignored files are excluded and warning is on stderr', t => {
  const r = repo(t); r.write('src/untracked.ts', '@app/legacy-client'); r.write('.gitignore', 'src/ignored.ts\n'); r.write('src/ignored.ts', '@app/legacy-client');
  const out = r.run(); status(out, 0, 'pass'); assert.equal(out.data.scannedFiles, 1); assert.match(out.stderr, /untracked files.*ignored files.*excluded/);
});
test('generated dependency directories skipped globally, not read', t => {
  const r = repo(t); for (const file of ['src/node_modules/a.ts', 'src/dist/a.ts', 'src/__generated__/a.ts']) { r.write(file, Buffer.from([0])); r.add(file); }
  const out = r.run(); status(out, 0, 'pass'); assert.equal(out.data.scannedFiles, 1);
  r.config([{ ...baseRule(), files: ['src/dist/**'] }]); status(r.run(), 2, 'incomplete');
});
for (const file of ['src/.env.local', 'src/keys/key.ts', 'src/keys.json', 'src/server.pem', 'src/id_rsa']) {
  test(`secret path ${file} is incomplete without exposing contents`, t => {
    const r = repo(t); r.write(file, 'do-not-print-this-secret'); r.add(file); r.config([{ ...baseRule(), files: ['src/**'] }]);
    const out = r.run(); status(out, 2, 'incomplete'); assert.ok(!out.stdout.includes('do-not-print-this-secret'));
  });
}
test('does not execute project code, lifecycle scripts, hooks, or configured fsmonitor', t => {
  const r = repo(t); const marker = path.join(r.root, 'EXECUTED');
  r.write('package.json', JSON.stringify({ scripts: { pretest: `touch ${marker}`, test: `touch ${marker}` } }));
  r.write('src/a.ts', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad');\n`);
  r.write('hook.sh', `#!/bin/sh\ntouch '${marker}'\n`); fs.chmodSync(path.join(r.root, 'hook.sh'), 0o755);
  execFileSync('git', ['-C', r.root, 'config', 'core.fsmonitor', path.join(r.root, 'hook.sh')]);
  r.write('.git/hooks/pre-commit', `#!/bin/sh\ntouch '${marker}'\n`); fs.chmodSync(path.join(r.root, '.git/hooks/pre-commit'), 0o755);
  const before = fs.readFileSync(path.join(r.root, '.git/index'));
  status(r.run(), 0, 'pass'); assert.equal(fs.existsSync(marker), false); assert.deepEqual(fs.readFileSync(path.join(r.root, '.git/index')), before);
});
test('help documents syntax, exit contract, literal scope and limitations', () => {
  const out = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' }); assert.equal(out.status, 0);
  for (const phrase of ['node /skill/scripts/guard.mjs --root /repo [--config .steward.json] [--json]', 'Exit 0:', '1: complete with matches', '2: invalid input', 'NOT architecture static analysis', 'lint/AST', 'Comments and strings count', '1 MiB']) assert.ok(out.stdout.includes(phrase), phrase);
});
test('missing root and nonrepository root are incomplete', t => {
  const missing = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' }); assert.equal(missing.status, 2); assert.equal(JSON.parse(missing.stdout).status, 'incomplete');
  const r = repo(t); fs.rmSync(path.join(r.root, '.git'), { recursive: true }); status(r.run(), 2, 'incomplete');
});

test('a whitespace token remains a valid literal, not silently trimmed', t => {
  const r = repo(t); r.config([{ ...baseRule(), forbid: [' '] }]); r.write('src/a.ts', 'has space\nno-space');
  const out = r.run(); status(out, 1, 'fail'); assert.equal(out.data.findings.length, 1); assert.equal(out.data.findings[0].line, 1);
});
test('a file selected by multiple rules is scanned once and checked by each', t => {
  const r = repo(t); r.config([baseRule(), { ...baseRule(), id: 'second-rule' }]); r.write('src/a.ts', '@app/legacy-client');
  const out = r.run(); status(out, 1, 'fail'); assert.equal(out.data.scannedFiles, 1); assert.deepEqual(out.data.findings.map(f => f.ruleId), ['no-legacy-client', 'second-rule']);
});
test('matching tracked path replaced by a directory is incomplete', t => {
  const r = repo(t); fs.unlinkSync(path.join(r.root, 'src/a.ts')); fs.mkdirSync(path.join(r.root, 'src/a.ts')); status(r.run(), 2, 'incomplete');
});

test('Windows drive-letter case does not change repository identity', { skip: process.platform !== 'win32' }, t => {
  const r = repo(t);
  const alternate = r.root[0] === r.root[0].toUpperCase() ? r.root[0].toLowerCase() + r.root.slice(1) : r.root[0].toUpperCase() + r.root.slice(1);
  const out = spawnSync(process.execPath, [script, '--root', alternate, '--json'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(JSON.parse(out.stdout).status, 'pass');
});
