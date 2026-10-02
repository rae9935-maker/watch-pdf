import { readFile } from 'node:fs/promises'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const data = await readFile(new URL('../public/sample.pdf', import.meta.url))
const doc = await pdfjs.getDocument({ data: new Uint8Array(data), disableWorker: true }).promise

const hits = []
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent()
  for (const raw of content.items) {
    if (!('str' in raw)) continue
    if (/입법조사|연구위원|저자|최/.test(raw.str)) {
      const t = raw.transform
      hits.push({ p, y: t[5].toFixed(0), str: raw.str, fs: Math.hypot(t[0], t[1]).toFixed(1) })
    }
  }
}
console.log(hits)
console.log('--- headings-like ---')
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent()
  const lines = new Map()
  for (const raw of content.items) {
    if (!('str' in raw) || !raw.str) continue
    const y = Math.round(raw.transform[5])
    const fs = Math.hypot(raw.transform[0], raw.transform[1])
    const key = `${p}:${y}`
    const cur = lines.get(key) ?? { text: '', fs: 0 }
    cur.text += raw.str
    cur.fs = Math.max(cur.fs, fs)
    lines.set(key, cur)
  }
  for (const [k, v] of [...lines.entries()].sort()) {
    const t = v.text.replace(/\s+/g, ' ').trim()
    if (/^\d+\.\s/.test(t) || /^\d+\)\s/.test(t) || /^[①-⑩]/.test(t)) {
      console.log(k, 'fs', v.fs.toFixed(1), t)
    }
  }
}

await doc.cleanup()
await doc.loadingTask.destroy()
