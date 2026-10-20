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
  for (const dir of [temp, plugin]) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }))
  const run = (arg) => spawnSync(process.execPath, [join(plugin, 'scripts/sync-version.mjs'), arg], { encoding: 'utf8' })
  for (const bad of ['0.6.4', 'v0.6.4-codex.1', '0.6.4-codex.0', '0.6.4-codex.01', '0.6.5-codex.1']) {
    assert.notEqual(run(bad).status, 0, `must reject ${bad}`)
    assert.equal(JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).version, version)
  }
  assert.equal(run('0.6.4-codex.2').status, 0)
  assert.equal(run('--check').status, 0)
  for (const dir of [temp, plugin]) assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, '0.6.4-codex.2')
  assert.ok(readFileSync(join(temp, 'README.md'), 'utf8').includes('version-v0.6.4--codex.2'))
  writeFileSync(join(temp, 'README.md'), 'No version marker\n')
  assert.notEqual(run('0.6.4-codex.3').status, 0)
  assert.equal(JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).version, '0.6.4-codex.2', 'failed validation must not partially update metadata')
  console.log('Codex version policy passed: suffix, iteration, DSH baseline, both lockfiles, badge and validation before writes.')
} finally { rmSync(temp, { recursive: true, force: true }) }
