import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOLDERS = ['src', 'dev', 'test-helpers']
const EXTENSIONS = new Set(['.js', '.njk', '.scss', '.md'])
// What a UTF-8 curly apostrophe, dash or quote looks like once it has been
// read as Windows-1252 and saved again: "â€™", "â€”", "Ã©".
const MOJIBAKE = [`\u00e2\u20ac`, `\u00c3\u00a9`, `\u00c3\u00a2`]

function sourceFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name)

    if (entry.isDirectory()) {
      return sourceFiles(full)
    }

    return EXTENSIONS.has(path.extname(entry.name)) ? [full] : []
  })
}

describe('#source encoding', () => {
  test('no source file has text that was saved with the wrong encoding (mojibake)', () => {
    const damaged = FOLDERS.flatMap((folder) =>
      sourceFiles(path.join(root, folder))
    )
      .filter((file) => {
        // This file names the sequences it looks for.
        if (file === fileURLToPath(import.meta.url)) {
          return false
        }

        const text = readFileSync(file, 'utf8')

        return MOJIBAKE.some((sequence) => text.includes(sequence))
      })
      .map((file) => path.relative(root, file))

    expect(damaged).toEqual([])
  })
})
