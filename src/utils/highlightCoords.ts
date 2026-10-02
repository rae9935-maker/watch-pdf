import type { PageViewport } from 'pdfjs-dist'

const FOOTNOTE_PDF_FONT = 9

export function markFootnoteSpans(container: HTMLElement, viewportScale: number) {
  for (const span of container.querySelectorAll('span')) {
    const px = parseFloat(getComputedStyle(span).fontSize)
    if (!Number.isFinite(px) || px <= 0) continue
    if (px / viewportScale < FOOTNOTE_PDF_FONT) {
      span.classList.add('footnote')
    }
  }
}

function isFootnoteNode(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return Boolean(el?.closest('.footnote'))
}

function selectedBodyText(range: Range, pageEl: HTMLElement): string {
  const parts: string[] = []
  const it = document.createNodeIterator(pageEl, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = it.nextNode())) {
    if (isFootnoteNode(node)) continue
    if (!range.intersectsNode(node)) continue
    const value = node.textContent ?? ''
    if (!value) continue
    let from = 0
    let to = value.length
    if (node === range.startContainer) from = range.startOffset
    if (node === range.endContainer) to = range.endOffset
    if (from < to) parts.push(value.slice(from, to))
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function rectHitsFootnote(rect: DOMRect, pageEl: HTMLElement): boolean {
  for (const span of pageEl.querySelectorAll('.footnote')) {
    const b = span.getBoundingClientRect()
    const overlap =
      rect.left < b.right && rect.right > b.left && rect.top < b.bottom && rect.bottom > b.top
    if (overlap && rect.height <= b.height * 1.5) return true
  }
  return false
}

export function selectionToQuads(
  pageEl: HTMLElement,
  viewport: PageViewport,
): { quads: number[][]; text: string; topY: number; midX: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!pageEl.contains(range.commonAncestorContainer)) return null

  const text = selectedBodyText(range, pageEl)
  if (text.length < 2) return null

  const pageRect = pageEl.getBoundingClientRect()
  const quads: number[][] = []
  let topY = -Infinity
  let minX = Infinity
  let maxX = -Infinity

  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue
    if (rectHitsFootnote(rect, pageEl)) continue
    const x1 = rect.left - pageRect.left
    const y1 = rect.top - pageRect.top
    const x2 = rect.right - pageRect.left
    const y2 = rect.bottom - pageRect.top
    const [ulx, uly] = viewport.convertToPdfPoint(x1, y1)
    const [urx, ury] = viewport.convertToPdfPoint(x2, y1)
    const [llx, lly] = viewport.convertToPdfPoint(x1, y2)
    const [lrx, lry] = viewport.convertToPdfPoint(x2, y2)
    quads.push([ulx, uly, urx, ury, llx, lly, lrx, lry])
    topY = Math.max(topY, uly, ury)
    minX = Math.min(minX, ulx, urx, llx, lrx)
    maxX = Math.max(maxX, ulx, urx, llx, lrx)
  }

  if (!quads.length) return null
  return { quads, text, topY, midX: (minX + maxX) / 2 }
}

export function quadsToCssRects(
  quads: number[][],
  viewport: PageViewport,
): { left: number; top: number; width: number; height: number }[] {
  return quads.map((q) => {
    const pts = [
      viewport.convertToViewportPoint(q[0], q[1]),
      viewport.convertToViewportPoint(q[2], q[3]),
      viewport.convertToViewportPoint(q[4], q[5]),
      viewport.convertToViewportPoint(q[6], q[7]),
    ]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return {
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
    }
  })
}
