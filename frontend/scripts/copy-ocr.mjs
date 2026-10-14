// Copies the offline OCR engine (Tesseract) into public/ocr so the app never depends on a CDN.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/ocr')
mkdirSync(out, { recursive: true })
const dir = (pkg) => path.dirname(require.resolve(`${pkg}/package.json`))
const files = [
  [path.join(dir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [path.join(dir('tesseract.js-core'), f), f]),
  [path.join(dir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
]
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`OCR file missing: ${from} — run npm install`)
  copyFileSync(from, path.join(out, to))
}
console.log(`OCR engine copied to public/ocr (${files.length} files)`)
