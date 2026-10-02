import type { JSONContent } from '@tiptap/core'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'
import {
  HIGHLIGHT_COLORS,
  OTHER_TOC_ID,
  type BulletInsert,
  type Highlight,
  type HighlightColorId,
  type PageText,
  type TocIndexEntry,
} from '../types'
import { findNearestToc } from './tocExtractor'

export const SESSION_FILENAME = 'watch-pdf-session.json'
const AUTHOR = 'watch-pdf'

const COLORS: HighlightColorId[] = ['yellow', 'green', 'pink']

export type WatchPdfSession = {
  v: 1
  highlights: Highlight[]
  digest: JSONContent | null
}

export type RestoredEditing = {
  highlights: Highlight[]
  digest: JSONContent | null
  pendingBullets: BulletInsert[]
}

function decodeText(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return null
}

function isColor(value: unknown): value is HighlightColorId {
  return value === 'yellow' || value === 'green' || value === 'pink'
}

function asQuads(value: unknown): number[][] | null {
  if (!Array.isArray(value) || !value.length) return null
  const quads: number[][] = []
  for (const quad of value) {
    if (!Array.isArray(quad) || quad.length < 8) return null
    const nums = quad.slice(0, 8).map((n) => Number(n))
    if (nums.some((n) => !Number.isFinite(n))) return null
    quads.push(nums)
  }
  return quads
}

function parseHighlight(value: unknown): Highlight | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Highlight>
  const quads = asQuads(raw.quads)
  if (!quads) return null
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null
  if (typeof raw.pageIndex !== 'number' || !Number.isFinite(raw.pageIndex)) return null
  return {
    id: raw.id,
    pageIndex: raw.pageIndex,
    quads,
    color: isColor(raw.color) ? raw.color : 'yellow',
    text: raw.text,
    tocId: typeof raw.tocId === 'string' ? raw.tocId : OTHER_TOC_ID,
  }
}

export function parseSession(text: string): WatchPdfSession | null {
  try {
    const raw = JSON.parse(text) as { highlights?: unknown; digest?: unknown }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.highlights)) return null
    const highlights = raw.highlights.map(parseHighlight).filter((h): h is Highlight => Boolean(h))
    const digest =
      raw.digest && typeof raw.digest === 'object' && (raw.digest as JSONContent).type === 'doc'
        ? (raw.digest as JSONContent)
        : null
    return { v: 1, highlights, digest }
  } catch {
    return null
  }
}

function sessionFilename(name: string): boolean {
  const base = name.replaceAll('\\', '/').split('/').pop() ?? name
  return base === SESSION_FILENAME
}

export async function readEmbeddedSession(pdf: PDFDocumentProxy): Promise<WatchPdfSession | null> {
  try {
    const attachments = await pdf.getAttachments()
    if (!attachments) return null
    for (const [id, attachment] of attachments) {
      const name = attachment.filename || attachment.rawFilename || id
      if (!sessionFilename(name) && !sessionFilename(id)) continue
      const content = attachment.content ?? (await pdf.getAttachmentContent(id))
      if (!content?.length) continue
      const session = parseSession(new TextDecoder().decode(content))
      if (session) return session
    }
  } catch {
    return null
  }
  return null
}

function numbersOf(array: PDFArray): number[] {
  const nums: number[] = []
  for (let i = 0; i < array.size(); i += 1) {
    const value = array.lookup(i)
    if (value instanceof PDFNumber) nums.push(value.asNumber())
  }
  return nums
}

function quadsFromPoints(points: number[]): number[][] {
  const quads: number[][] = []
  for (let i = 0; i + 7 < points.length; i += 8) quads.push(points.slice(i, i + 8))
  return quads
}

function nearestColor(rgb: number[]): HighlightColorId {
  let best: HighlightColorId = 'yellow'
  let bestDistance = Infinity
  for (const id of COLORS) {
    const [r, g, b] = HIGHLIGHT_COLORS[id].pdf
    const distance = (r - (rgb[0] ?? 0)) ** 2 + (g - (rgb[1] ?? 0)) ** 2 + (b - (rgb[2] ?? 0)) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = id
    }
  }
  return best
}

function quadAnchor(quads: number[][]): { topY: number; midX: number } {
  let topY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  for (const quad of quads) {
    for (let i = 0; i < 8; i += 2) {
      minX = Math.min(minX, quad[i])
      maxX = Math.max(maxX, quad[i])
      topY = Math.max(topY, quad[i + 1])
    }
  }
  return { topY, midX: (minX + maxX) / 2 }
}

function isWatchAnnot(annot: PDFDict): boolean {
  if (annot.has(PDFName.of('WatchId'))) return true
  return decodeText(annot.lookup(PDFName.of('T'))) === AUTHOR
}

export async function readLegacyHighlights(source: ArrayBuffer): Promise<Highlight[]> {
  const pdf = await PDFDocument.load(source.slice(0), { updateMetadata: false })
  const grouped = new Map<string, Highlight>()
  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots()
    if (!annots) return
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookup(i)
      if (!(annot instanceof PDFDict) || !isWatchAnnot(annot)) continue
      if (annot.lookup(PDFName.of('Subtype')) !== PDFName.of('Highlight')) continue
      const quadArray = annot.lookup(PDFName.of('QuadPoints'))
      if (!(quadArray instanceof PDFArray)) continue
      const quads = quadsFromPoints(numbersOf(quadArray))
      if (!quads.length) continue
      const text = decodeText(annot.lookup(PDFName.of('Contents'))) ?? ''
      if (text.trim().length < 2) continue
      const colorArray = annot.lookup(PDFName.of('C'))
      const color =
        colorArray instanceof PDFArray ? nearestColor(numbersOf(colorArray)) : 'yellow'
      const watchId = decodeText(annot.lookup(PDFName.of('WatchId')))
      const key = watchId ?? `${pageIndex}|${color}|${text}`
      const existing = grouped.get(key)
      if (existing) {
        existing.quads.push(...quads)
        continue
      }
      grouped.set(key, {
        id: watchId ?? crypto.randomUUID(),
        pageIndex,
        quads,
        color,
        text,
        tocId: OTHER_TOC_ID,
      })
    }
  })
  return [...grouped.values()]
}

function textCoveredBy(quads: number[][], page: PageText | undefined): string {
  if (!page) return ''
  const rects = quads.map((quad) => {
    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
  })
  const hits = page.items.filter((item) => {
    const top = item.y + Math.max(item.height, item.fontSize)
    const bottom = item.y - item.fontSize * 0.25
    const right = item.x + Math.max(item.width, 0.5)
    return rects.some((rect) => item.x < rect.x2 && right > rect.x1 && bottom < rect.y2 && top > rect.y1)
  })
  hits.sort((a, b) => (Math.abs(b.y - a.y) > 1.5 ? b.y - a.y : a.x - b.x))
  return hits
    .map((item) => item.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function withPageText(highlights: Highlight[], pages: PageText[]): Highlight[] {
  return highlights.map((highlight) => {
    const covered = textCoveredBy(highlight.quads, pages[highlight.pageIndex])
    return covered.length >= 2 ? { ...highlight, text: covered } : highlight
  })
}

function bulletsFor(highlights: Highlight[]): BulletInsert[] {
  return highlights.map((h) => ({
    id: h.id,
    tocId: h.tocId,
    text: h.text,
    pageNumber: h.pageIndex + 1,
  }))
}

function assignToc(
  highlights: Highlight[],
  pages: PageText[],
  tocIndex: TocIndexEntry[],
): Highlight[] {
  if (!tocIndex.length) return highlights
  return highlights.map((h) => {
    const { topY, midX } = quadAnchor(h.quads)
    const pageWidth = pages[h.pageIndex]?.width ?? 612
    const col = midX < pageWidth / 2 ? 'left' : 'right'
    const toc = findNearestToc(h.pageIndex, topY, col, tocIndex)
    return { ...h, tocId: toc?.id ?? OTHER_TOC_ID }
  })
}

export async function restoreEditingState(
  pdf: PDFDocumentProxy,
  pdfBytes: ArrayBuffer,
  pages: PageText[],
  tocIndex: TocIndexEntry[],
): Promise<RestoredEditing> {
  const session = await readEmbeddedSession(pdf)
  if (session) {
    return {
      highlights: session.highlights,
      digest: session.digest,
      pendingBullets: session.digest ? [] : bulletsFor(session.highlights),
    }
  }

  try {
    const legacy = assignToc(withPageText(await readLegacyHighlights(pdfBytes), pages), pages, tocIndex)
    if (legacy.length) {
      return { highlights: legacy, digest: null, pendingBullets: bulletsFor(legacy) }
    }
  } catch {
    /* 세션이 없는 일반 PDF */
  }
  return { highlights: [], digest: null, pendingBullets: [] }
}

export function detachSession(pdf: PDFDocument) {
  if (!pdf.catalog.has(PDFName.of('Names'))) return
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict)
  if (!names.has(PDFName.of('EmbeddedFiles'))) return
  const embedded = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict)
  if (!embedded.has(PDFName.of('Names'))) return
  const efNames = embedded.lookup(PDFName.of('Names'), PDFArray)
  const kept: ReturnType<PDFArray['get']>[] = []
  const removed = new Set<string>()
  for (let i = 0; i + 1 < efNames.size(); i += 2) {
    const name = decodeText(efNames.lookup(i)) ?? ''
    const ref = efNames.get(i + 1)
    if (sessionFilename(name) && ref instanceof PDFRef) {
      removed.add(ref.tag)
      continue
    }
    kept.push(efNames.get(i), ref)
  }
  embedded.set(PDFName.of('Names'), pdf.context.obj(kept))

  if (!pdf.catalog.has(PDFName.of('AF'))) return
  const af = pdf.catalog.lookup(PDFName.of('AF'), PDFArray)
  const keptAf = []
  for (let i = 0; i < af.size(); i += 1) {
    const ref = af.get(i)
    if (ref instanceof PDFRef && removed.has(ref.tag)) continue
    keptAf.push(ref)
  }
  pdf.catalog.set(PDFName.of('AF'), pdf.context.obj(keptAf))
}

export function stripWatchAnnots(pdf: PDFDocument) {
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    const kept = []
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookup(i)
      if (annot instanceof PDFDict && isWatchAnnot(annot)) continue
      kept.push(annots.get(i))
    }
    if (kept.length) page.node.set(PDFName.of('Annots'), pdf.context.obj(kept))
    else page.node.delete(PDFName.of('Annots'))
  }
}
