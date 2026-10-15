#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(scriptDir, '..')
const repositoryRoot = resolve(pluginRoot, '../..')

const paths = {
  packageJson: resolve(pluginRoot, 'package.json'),
  pluginManifest: resolve(pluginRoot, '.codex-plugin/plugin.json'),
  readme: resolve(repositoryRoot, 'README.md'),
  packageLock: resolve(repositoryRoot, 'package-lock.json'),
}

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
  if (matches?.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches?.length ?? 0}`)
  }
  return source.replace(pattern, replacement)
}

function writeTopLevelJsonVersion(path, version) {
  const document = readJson(path)
  if (typeof document.version !== 'string') throw new Error(`${path}: missing string version field`)

  const source = readFileSync(path, 'utf8')
  const updated = replaceExactlyOnce(
    source,
    /^(\s*"version"\s*:\s*)"[^"]+"/m,
    `$1"${version}"`,
    `${path} version`,
  )
  writeFileSync(path, updated)
}

function shieldsVersion(version) {
  return encodeURIComponent(`v${version}`).replaceAll('-', '--')
}

function expectedReadme(version) {
  return {
    badge: `https://img.shields.io/badge/version-${shieldsVersion(version)}-4a43ea" alt="Version ${version}"`,
  }
}

function updateReadme(version) {
  const source = readFileSync(paths.readme, 'utf8')
  const expected = expectedReadme(version)
  const withBadge = replaceExactlyOnce(
    source,
    /https:\/\/img\.shields\.io\/badge\/version-[^"]+" alt="Version [^"]+"/,
    expected.badge,
    'README version badge',
  )
  writeFileSync(paths.readme, withBadge)
}

function updatePackageLock(version) {
  if (!existsSync(paths.packageLock)) return
  const lock = readJson(paths.packageLock)
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  writeJson(paths.packageLock, lock)
}

function assertSynchronized(version) {
  const manifest = readJson(paths.pluginManifest)
  if (manifest.version !== version) {
    throw new Error(`plugin manifest version is ${manifest.version}; expected ${version}`)
  }

  const readme = readFileSync(paths.readme, 'utf8')
  const expected = expectedReadme(version)
  if (!readme.includes(expected.badge)) {
    throw new Error(`README version markers do not match ${version}`)
  }

  if (existsSync(paths.packageLock)) {
    const lock = readJson(paths.packageLock)
    if (lock.version !== version || lock.packages?.['']?.version !== version) {
      throw new Error(`package-lock.json version markers do not match ${version}`)
    }
  }
}

const argument = process.argv[2]
const checkOnly = argument === '--check'
const packageJson = readJson(paths.packageJson)
const version = checkOnly ? packageJson.version : argument

if (typeof version !== 'string' || !semverPattern.test(version)) {
  console.error('Usage: npm run version:set -- <semver>')
  console.error('Example: npm run version:set -- 0.2.0-codex.2')
  process.exitCode = 1
} else {
  if (!checkOnly) {
    writeTopLevelJsonVersion(paths.packageJson, version)
    writeTopLevelJsonVersion(paths.pluginManifest, version)
    updateReadme(version)
    updatePackageLock(version)
  }

  assertSynchronized(version)
  console.log(checkOnly ? `Version markers are synchronized at ${version}.` : `Set plugin version to ${version}.`)
}
