import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules'].includes(entry.name)) return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? files(full) : [full]
  })
}

test('skill metadata is portable and the main workflow stays focused', () => {
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\r?\nname: "codebase-steward"\r?\ndescription: "[^\r\n]+"\r?\n---/)
  assert.ok(skill.split(/\s+/).length < 1500)
  assert.doesNotMatch(skill, /https?:\/\/|youtube|youtu\.be/i)
  for (const section of ['Establish the task', 'Inspect the relevant slice', 'Choose the smallest sound change', 'Implement within scope', 'Prove the result', 'Hand off and recommend']) assert.ok(skill.includes(section))
})

test('local Markdown references resolve and public prose has no private host paths', () => {
  for (const file of files(root).filter(file => file.endsWith('.md'))) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /\/Users\/|\.aside\/u\//, file)
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(match[1])) continue
      const target = path.resolve(path.dirname(file), decodeURIComponent(match[1].split('#')[0]))
      assert.ok(target.startsWith(root), `${file}: reference leaves repository`)
      assert.ok(existsSync(target), `${file}: broken reference ${match[1]}`)
    }
  }
})

test('tools are dependency-free and the example is explicit opt-in configuration', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.private, true)
  assert.equal(pkg.scripts.test, 'node --test')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
  const example = JSON.parse(readFileSync(path.join(root, 'examples/steward.json'), 'utf8'))
  assert.equal(example.version, 1)
  assert.equal(example.rules[0].id, 'no-legacy-client')
  assert.ok(!existsSync(path.join(root, '.steward.json')))
})

test('upstream attribution and native workflow image are bundled', () => {
  assert.match(readFileSync(path.join(root, 'licenses/pstack-MIT.txt'), 'utf8'), /Copyright \(c\) 2026 Lauren Tan/)
  assert.match(readFileSync(path.join(root, 'NOTICE.md'), 'utf8'), /independent adaptation/)
  const image = readFileSync(path.join(root, 'docs/workflow.png'))
  assert.equal(image.subarray(1, 4).toString(), 'PNG')
  assert.ok(image.readUInt32BE(16) >= 1200)
})
