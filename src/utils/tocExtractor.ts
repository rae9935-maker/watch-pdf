import type { PDFDocumentProxy } from 'pdfjs-dist'
import { OTHER_TOC_ID, type PageText, type TocIndexEntry, type TocNode } from '../types'
import { linesInReadingOrder, type TextLine } from './columnOrder'

const MAJOR = /^(\d+)\.\s+\S/
const MID_PAREN = /^(\d+)\)\s+\S/
const MID_DOT = /^(\d+)\.(\d+)\s+\S/
const MINOR = /^[①-⑩]\s+\S|^[가-하]\.\s+\S/

function flatten(nodes: TocNode[]): TocIndexEntry[] {
  const out: TocIndexEntry[] = []
  const walk = (list: TocNode[]) => {
    for (const n of list) {
      out.push({
        id: n.id,
        level: n.level,
        title: n.title,
        pageIndex: n.pageIndex,
        topY: n.topY,
        col: n.col,
      })
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

function makeOther(): TocNode {
  return {
    id: OTHER_TOC_ID,
    level: 1,
    title: '기타',
    pageIndex: 0,
    topY: 0,
    col: 'span',
    children: [],
  }
}

export function tocIndexFromTree(toc: TocNode[]): TocIndexEntry[] {
  return flatten(toc)
}

export function findNearestToc(
  pageIndex: number,
  topY: number,
  col: 'left' | 'right',
  index: TocIndexEntry[],
): TocIndexEntry {
  let best: TocIndexEntry | undefined
  for (const entry of index) {
    if (entry.id === OTHER_TOC_ID) continue
    if (!headingPrecedes(entry, pageIndex, topY, col)) continue
    best = entry
  }
  return best ?? index.find((e) => e.id === OTHER_TOC_ID) ?? index[0]
}

function headingPrecedes(
  entry: TocIndexEntry,
  pageIndex: number,
  topY: number,
  col: 'left' | 'right',
): boolean {
  if (entry.pageIndex < pageIndex) return true
  if (entry.pageIndex > pageIndex) return false
  if (entry.col === 'span') return entry.topY >= topY - 4
  if (col === 'left') {
    if (entry.col === 'right') return false
    return entry.topY >= topY - 4
  }
  if (entry.col === 'left') return true
  return entry.topY >= topY - 4
}

async function fromOutline(pdf: PDFDocumentProxy): Promise<TocNode[] | null> {
  const outline = await pdf.getOutline()
  if (!outline?.length) return null

  let seq = 0
  const resolve = async (
    items: typeof outline,
    level: number,
  ): Promise<TocNode[]> => {
    const nodes: TocNode[] = []
    for (const item of items) {
      let pageIndex = 0
      let topY = 0
      try {
        const dest =
          typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
        if (dest?.[0]) {
          pageIndex = await pdf.getPageIndex(dest[0])
        }
      } catch {
        pageIndex = 0
      }
      seq += 1
      const children = item.items?.length ? await resolve(item.items, level + 1) : []
      nodes.push({
        id: `toc-${seq}`,
        level,
        title: item.title.replace(/\s+/g, ' ').trim(),
        pageIndex,
        topY,
        col: 'span',
        children,
      })
    }
    return nodes
  }

  const tree = await resolve(outline, 1)
  return tree.length ? tree : null
}

function isNumberedHeading(line: TextLine): boolean {
  return MAJOR.test(line.text) && !MID_DOT.test(line.text) && line.fontSize >= 10.6
}

function sameColumn(a: TextLine, b: TextLine): boolean {
  return a.col === 'span' || b.col === 'span' || a.col === b.col
}

function wrapHeading(lines: TextLine[], start: number, pageWidth: number): { title: string; consumed: number } {
  const heading = lines[start]
  let title = heading.text
  let consumed = 1
  const colW = heading.col === 'span' ? pageWidth : pageWidth / 2
  const headingW = heading.maxX - heading.minX

  for (let j = start + 1; j < lines.length; j += 1) {
    const next = lines[j]
    if (isNumberedHeading(next) || MID_PAREN.test(next.text) || MINOR.test(next.text)) break
    if (!sameColumn(heading, next)) break
    if (Math.abs(next.fontSize - heading.fontSize) > 0.45) break
    if (heading.y - next.y > heading.fontSize * 2.2) break
    const nextW = next.maxX - next.minX
    if (nextW > colW * 0.66) break
    if (nextW > headingW * 1.05) break
    if (next.text.length < 2 || next.text.length > 36) break
    if (title.length + 1 + next.text.length > 90) break
    title = `${title} ${next.text}`
    consumed += 1
  }
  return { title: title.replace(/\s+/g, ' ').trim(), consumed }
}

function fromRules(pages: PageText[]): TocNode[] {
  const majors: TocNode[] = []
  let seq = 0
  let currentMajor: TocNode | undefined

  for (const page of pages) {
    const lines = linesInReadingOrder(page.items, page.width)
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.text.length < 3 || line.fontSize < 10.6) {
        i += 1
        continue
      }

      const numbered = isNumberedHeading(line)
      const wrapped = numbered || MID_PAREN.test(line.text) || MINOR.test(line.text)
        ? wrapHeading(lines, i, page.width)
        : { title: line.text, consumed: 1 }

      if (numbered && line.fontSize >= 13.2) {
        seq += 1
        currentMajor = {
          id: `toc-${seq}`,
          level: 1,
          title: wrapped.title,
          pageIndex: page.pageIndex,
          topY: line.y,
          col: line.col,
          children: [],
        }
        majors.push(currentMajor)
        i += wrapped.consumed
        continue
      }

      if (numbered && currentMajor && line.fontSize < 13.2) {
        seq += 1
        currentMajor.children.push({
          id: `toc-${seq}`,
          level: 2,
          title: wrapped.title,
          pageIndex: page.pageIndex,
          topY: line.y,
          col: line.col,
          children: [],
        })
        i += wrapped.consumed
        continue
      }

      if ((MID_PAREN.test(line.text) || MID_DOT.test(line.text)) && currentMajor && line.fontSize >= 10.8) {
        seq += 1
        currentMajor.children.push({
          id: `toc-${seq}`,
          level: 2,
          title: wrapped.title,
          pageIndex: page.pageIndex,
          topY: line.y,
          col: line.col,
          children: [],
        })
        i += wrapped.consumed
        continue
      }

      if (MINOR.test(line.text) && currentMajor && line.fontSize >= 10.8) {
        const parent = currentMajor.children.at(-1) ?? currentMajor
        seq += 1
        parent.children.push({
          id: `toc-${seq}`,
          level: 3,
          title: wrapped.title,
          pageIndex: page.pageIndex,
          topY: line.y,
          col: line.col,
          children: [],
        })
        i += wrapped.consumed
        continue
      }

      i += 1
    }
  }

  return majors
}

export async function extractToc(pdf: PDFDocumentProxy, pages: PageText[]): Promise<TocNode[]> {
  const outlined = await fromOutline(pdf)
  const tree = outlined ?? fromRules(pages)
  const withOther = [...tree, makeOther()]
  return withOther.length ? withOther : [makeOther()]
}
