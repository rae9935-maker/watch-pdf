export type PdfTextItem = {
  str: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export type PageText = {
  pageIndex: number
  width: number
  height: number
  items: PdfTextItem[]
}

export type Metadata = {
  title: string
  subtitle: string
  organization: string
  series: string
  issue: string
  date: string
  authors: string
}

export type ColumnId = 'left' | 'right' | 'span'

export type TocNode = {
  id: string
  level: number
  title: string
  pageIndex: number
  topY: number
  col: ColumnId
  children: TocNode[]
}

export type TocIndexEntry = {
  id: string
  level: number
  title: string
  pageIndex: number
  topY: number
  col: ColumnId
}

export type LayoutMode = 'split' | 'pdf' | 'digest'
export type PdfTool = 'highlight' | 'eraser'
export type HighlightColorId = 'yellow' | 'green' | 'pink'


export type Highlight = {
  id: string
  pageIndex: number
  quads: number[][]
  color: HighlightColorId
  text: string
  tocId: string
}

export type BulletInsert = {
  id: string
  tocId: string
  text: string
  pageNumber: number
}

export type ScrollRequest = {
  pageIndex: number
  nonce: number
}

export const OTHER_TOC_ID = 'other'

export const HIGHLIGHT_COLORS: Record<
  HighlightColorId,
  { css: string; pdf: [number, number, number]; swatch: string }
> = {
  yellow: { css: 'rgba(255, 235, 59, 0.42)', pdf: [1, 0.92, 0.23], swatch: '#fde047' },
  green: { css: 'rgba(129, 199, 132, 0.42)', pdf: [0.5, 0.78, 0.52], swatch: '#86efac' },
  pink: { css: 'rgba(244, 143, 177, 0.42)', pdf: [0.96, 0.56, 0.69], swatch: '#f9a8d4' },
}
