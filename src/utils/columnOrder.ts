import type { PdfTextItem } from '../types'

export type TextLine = {
  y: number
  text: string
  fontSize: number
  minX: number
  maxX: number
  col: 'left' | 'right' | 'span'
  items: PdfTextItem[]
}

type Line = {
  y: number
  items: PdfTextItem[]
  minX: number
  maxX: number
  col: 'left' | 'right' | 'span'
}

function clusterLines(items: PdfTextItem[], pageWidth?: number): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const mid = pageWidth ? pageWidth / 2 : null
  const colOf = (x: number, width: number): 'left' | 'right' | 'span' => {
    if (!mid) return 'span'
    if (x < mid * 0.45 && x + width > mid * 1.1) return 'span'
    return x + width / 2 < mid ? 'left' : 'right'
  }

  const lines: Line[] = []
  for (const item of sorted) {
    const last = lines[lines.length - 1]
    const yTol = Math.max(item.fontSize * 0.45, 2)
    const itemCol = colOf(item.x, item.width)
    const canMerge =
      last &&
      Math.abs(last.y - item.y) <= yTol &&
      (last.col === 'span' || itemCol === 'span' || last.col === itemCol)

    if (canMerge && last) {
      last.items.push(item)
      last.minX = Math.min(last.minX, item.x)
      last.maxX = Math.max(last.maxX, item.x + item.width)
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length
      if (last.col !== itemCol) last.col = 'span'
    } else {
      lines.push({
        y: item.y,
        items: [item],
        minX: item.x,
        maxX: item.x + item.width,
        col: itemCol,
      })
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
  }
  return lines
}

function finalizeColumns(lines: Line[], pageWidth: number): Line[] {
  const mid = pageWidth / 2
  for (const line of lines) {
    if (line.minX < mid * 0.42 && line.maxX > mid * 1.12) {
      line.col = 'span'
    } else if ((line.minX + line.maxX) / 2 < mid) {
      line.col = 'left'
    } else {
      line.col = 'right'
    }
  }
  return lines
}

function toTextLine(line: Line): TextLine {
  return {
    y: line.y,
    text: line.items
      .map((it) => it.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
    fontSize: Math.max(...line.items.map((it) => it.fontSize)),
    minX: line.minX,
    maxX: line.maxX,
    col: line.col,
    items: line.items,
  }
}

function readingOrder(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => b.y - a.y)
  const ordered: Line[] = []
  let i = 0
  while (i < sorted.length) {
    if (sorted[i].col === 'span') {
      ordered.push(sorted[i])
      i += 1
      continue
    }
    const block: Line[] = []
    while (i < sorted.length && sorted[i].col !== 'span') {
      block.push(sorted[i])
      i += 1
    }
    const left = block.filter((l) => l.col === 'left').sort((a, b) => b.y - a.y)
    const right = block.filter((l) => l.col === 'right').sort((a, b) => b.y - a.y)
    ordered.push(...left, ...right)
  }
  return ordered
}

export function orderTwoColumn(items: PdfTextItem[], pageWidth: number): PdfTextItem[] {
  if (items.length === 0) return []
  const lines = finalizeColumns(clusterLines(items, pageWidth), pageWidth)
  return readingOrder(lines).flatMap((line) => line.items)
}

export function linesFromItems(items: PdfTextItem[], pageWidth?: number): TextLine[] {
  const lines = pageWidth
    ? finalizeColumns(clusterLines(items, pageWidth), pageWidth)
    : clusterLines(items, pageWidth)
  return lines.map(toTextLine)
}

export function linesInReadingOrder(items: PdfTextItem[], pageWidth: number): TextLine[] {
  const lines = finalizeColumns(clusterLines(items, pageWidth), pageWidth)
  return readingOrder(lines).map(toTextLine).filter((l) => l.text.length > 0)
}
