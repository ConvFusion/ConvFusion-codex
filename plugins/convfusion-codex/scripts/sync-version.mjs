#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(pluginRoot, '../..')
const paths = {
  packageJson: resolve(pluginRoot, 'package.json'),
  pluginManifest: resolve(pluginRoot, '.codex-plugin/plugin.json'),
  readme: resolve(repositoryRoot, 'README.md'),
  baseline: resolve(pluginRoot, 'assets/dsh-baseline.json'),
}
const lockPaths = [resolve(repositoryRoot, 'package-lock.json'), resolve(pluginRoot, 'package-lock.json')]
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-codex\.([1-9]\d*)$/
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
  if (matches?.length !== 1) throw new Error(`${label}: expected exactly one match, found ${matches?.length ?? 0}`)
  return source.replace(pattern, replacement)
}
function expectedBadge(version) {
  return `https://img.shields.io/badge/version-${encodeURIComponent(`v${version}`).replaceAll('-', '--')}-4a43ea" alt="Version ${version}"`
}
function assertBaseline(version) {
  if (!existsSync(paths.baseline)) throw new Error('Missing assets/dsh-baseline.json; verify the DSH synchronization baseline first.')
  const base = version.split('-codex.')[0]
  const baseline = readJson(paths.baseline)
  if (baseline.version !== base) throw new Error(`Version base ${base} does not match the synchronized DSH baseline ${baseline.version}. Change the base only as part of an explicitly requested DSH synchronization.`)
}
function assertSynchronized(version) {
  if (readJson(paths.pluginManifest).version !== version) throw new Error(`Plugin manifest version does not match ${version}`)
  if (!readFileSync(paths.readme, 'utf8').includes(expectedBadge(version))) throw new Error(`README badge does not match ${version}`)
  for (const path of lockPaths.filter(existsSync)) {
    const lock = readJson(path)
    if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error(`${path} version does not match ${version}`)
  }
}
const current = readJson(paths.packageJson).version
const checkOnly = process.argv[2] === '--check'
const version = checkOnly ? current : process.argv[2]
if (typeof version !== 'string' || !versionPattern.test(version)) {
  console.error('Version must use MAJOR.MINOR.PATCH-codex.N (N starts at 1; no v prefix).')
  console.error('Usage: npm run version:set -- <DSH-base>-codex.<iteration>')
  process.exitCode = 1
} else {
  assertBaseline(version)
  if (!checkOnly) {
    // Validate every target before writing any file, so a missing README marker cannot leave a partial bump.
    const updates = [paths.packageJson, paths.pluginManifest].map((path) => ({
      path, text: replaceExactlyOnce(readFileSync(path, 'utf8'), /^(\s*"version"\s*:\s*)"[^"]+"/m, `$1"${version}"`, `${path} version`),
    }))
    updates.push({ path: paths.readme, text: replaceExactlyOnce(readFileSync(paths.readme, 'utf8'), /https:\/\/img\.shields\.io\/badge\/version-[^"]+" alt="Version [^"]+"/, expectedBadge(version), 'README version badge') })
    for (const path of lockPaths.filter(existsSync)) {
      const lock = readJson(path)
      if (!lock.packages?.['']) throw new Error(`${path}: missing root package entry`)
      lock.version = version
      lock.packages[''].version = version
      updates.push({ path, text: JSON.stringify(lock, null, 2) + '\n' })
    }
    for (const update of updates) writeFileSync(update.path, update.text)
  }
  assertSynchronized(version)
  console.log(checkOnly ? `Version markers are synchronized at ${version}.` : `Set plugin version to ${version}.`)
}
