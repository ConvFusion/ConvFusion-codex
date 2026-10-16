#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const hostPackages = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-util-values',
]

const failures = []

for (const name of hostPackages) {
  if (!pkg.dependencies?.[name]) failures.push(`${name} must be declared for the standalone runtime build`)
  if (pkg.peerDependencies?.[name]) failures.push(`${name} must not require a DSH host in Codex`)
}
for (const artifact of ['codex-runtime-manifest.json', 'codex-hooks-manifest.json']) {
  const bundle = JSON.parse(readFileSync(join(root, 'lib', artifact), 'utf8'))
  if (!bundle.dependencies?.length) failures.push(`${artifact} must record bundled dependency notices`)
}

if (failures.length > 0) {
  console.error('Host dependency contract check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`Codex standalone dependency contract OK (${hostPackages.length} shared build dependencies, MCP and hook bundles)`)
