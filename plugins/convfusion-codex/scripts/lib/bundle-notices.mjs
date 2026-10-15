/** Preserve the licenses/notices of dependencies incorporated into a distributable bundle. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
export function writeBundleNotices(root, metafile, name) {
  const packages = new Map()
  for (const input of Object.keys(metafile.inputs)) {
    const absolute = resolve(root, input).replaceAll('\\', '/')
    const marker = absolute.lastIndexOf('/node_modules/')
    if (marker < 0) continue
    const tail = absolute.slice(marker + '/node_modules/'.length).split('/')
    const packagePath = absolute.slice(0, marker + '/node_modules/'.length) + tail.slice(0, tail[0].startsWith('@') ? 2 : 1).join('/')
    const metadata = join(packagePath, 'package.json')
    if (!existsSync(metadata)) continue
    const pkg = JSON.parse(readFileSync(metadata, 'utf8'))
    const id = `${pkg.name}@${pkg.version}`
    if (packages.has(id)) continue
    const notices = readdirSync(packagePath).filter((file) => /^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(file))
    packages.set(id, { id, license: pkg.license ?? 'See package notices', text: notices.map((file) => `--- ${file} ---\n${readFileSync(join(packagePath, file), 'utf8')}`).join('\n\n') })
  }
  const items = [...packages.values()].sort((a, b) => a.id.localeCompare(b.id))
  writeFileSync(join(root, 'lib', `${name}-notices.txt`), items.map((pkg) => `${pkg.id}\nLicense: ${pkg.license}\n\n${pkg.text}`).join('\n\n============================================================\n\n').trimEnd() + '\n')
  return items.map(({ id, license }) => ({ id, license }))
}
