#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'convfusion-version-'))
try {
  const plugin = join(temp, 'plugins/convfusion-codex')
  for (const name of ['package.json', '.codex-plugin/plugin.json', 'scripts/sync-version.mjs', 'assets/dsh-baseline.json']) {
    mkdirSync(dirname(join(plugin, name)), { recursive: true }); copyFileSync(join(root, name), join(plugin, name))
  }
  copyFileSync(join(root, '../../README.md'), join(temp, 'README.md'))
  const version = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).version
  const baseline = JSON.parse(readFileSync(join(plugin, 'assets/dsh-baseline.json'), 'utf8'))
  const base = baseline.version
  const parts = base.split('.').map(Number)
  const otherBase = `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  const updatedVersion = `${base}-codex.2`
  for (const dir of [temp, plugin]) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }))
  const run = (arg) => spawnSync(process.execPath, [join(plugin, 'scripts/sync-version.mjs'), arg], { encoding: 'utf8' })
  const unrelatedVersion = [`${otherBase}-codex.1`, `${otherBase}-codex.2`].find((candidate) => candidate !== baseline.codexVersionOverride)
  assert.equal(run('--check').status, 0)
  for (const bad of [base, `v${base}-codex.1`, `${base}-codex.0`, `${base}-codex.01`, unrelatedVersion]) {
    assert.notEqual(run(bad).status, 0, `must reject ${bad}`)
    assert.equal(JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).version, version)
  }
  assert.equal(run(updatedVersion).status, 0)
  assert.equal(run('--check').status, 0)
  for (const dir of [temp, plugin]) assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, updatedVersion)
  assert.ok(readFileSync(join(temp, 'README.md'), 'utf8').includes(`version-v${base}--codex.2`))
  if (baseline.codexVersionOverride) {
    assert.equal(run(baseline.codexVersionOverride).status, 0)
    assert.equal(run('--check').status, 0)
    assert.equal(run(updatedVersion).status, 0)
  }
  writeFileSync(join(temp, 'README.md'), 'No version marker\n')
  assert.notEqual(run(`${base}-codex.3`).status, 0)
  assert.equal(JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).version, updatedVersion, 'failed validation must not partially update metadata')
  console.log('Codex version policy passed: suffix, iteration, DSH baseline, both lockfiles, badge and validation before writes.')
} finally { rmSync(temp, { recursive: true, force: true }) }
