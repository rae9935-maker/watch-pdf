import type { JSONContent } from '@tiptap/core'
import { create } from 'zustand'
import {
  HIGHLIGHT_COLORS,
  OTHER_TOC_ID,
  type BulletInsert,
  type Highlight,
  type HighlightColorId,
  type LayoutMode,
  type Metadata,
  type PageText,
  type PdfTool,
  type ScrollRequest,
  type TocIndexEntry,
  type TocNode,
} from '../types'
import { extractMetadata } from '../utils/metadataExtractor'
import { extractPages, openPdf } from '../utils/pdfLoader'
import { extractToc, findNearestToc, tocIndexFromTree } from '../utils/tocExtractor'
import { restoreEditingState } from '../utils/watchSession'

export { HIGHLIGHT_COLORS }

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export type DigestTheme = 'light' | 'dark'

function readDigestTheme(): DigestTheme {
  try {
    return localStorage.getItem('watch-pdf-digest-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

type DocumentState = {
  fileName: string | null
  loading: boolean
  error: string | null
  pdfBytes: ArrayBuffer | null
  numPages: number
  pages: PageText[]
  metadata: Metadata
  toc: TocNode[]
  tocIndex: TocIndexEntry[]
  highlights: Highlight[]
  highlightColor: HighlightColorId
  zoom: number
  pendingBullets: BulletInsert[]
  digestSeed: JSONContent | null
  digestJson: JSONContent | null
  loadGeneration: number
  scrollRequest: ScrollRequest | null
  pdfTool: PdfTool
  layoutMode: LayoutMode
  splitRatio: number
  pendingDeletes: string[]
  digestTheme: DigestTheme
  loadFile: (file: File) => Promise<void>
  setZoom: (zoom: number) => void
  setHighlightColor: (color: HighlightColorId) => void
  captureSelection: (
    pageIndex: number,
    quads: number[][],
    text: string,
    topY: number,
    midX: number,
  ) => void
  consumeBullet: (id: string) => void
  consumeDelete: (id: string) => void
  removeHighlight: (id: string) => void
  setPdfTool: (tool: PdfTool) => void
  setLayoutMode: (mode: LayoutMode) => void
  setSplitRatio: (ratio: number) => void
  setDigestTheme: (theme: DigestTheme) => void
  setDigestJson: (json: JSONContent) => void
  requestScroll: (pageIndex: number) => void
  clearScrollRequest: () => void
}

const emptyMeta: Metadata = {
  title: '',
  subtitle: '',
  organization: '',
  series: '',
  issue: '',
  date: '',
  authors: '',
}

function seedFromToc(metadata: Metadata, toc: TocNode[]): JSONContent {
  const content: JSONContent[] = []
  if (metadata.title) {
    content.push({ type: 'heading', attrs: { level: 1, tocId: null }, content: [{ type: 'text', text: metadata.title }] })
  }
  const walk = (nodes: TocNode[]) => {
    for (const node of nodes) {
      if (node.id === OTHER_TOC_ID && nodes.length > 1) {
        content.push({
          type: 'heading',
          attrs: { level: 2, tocId: node.id },
          content: [{ type: 'text', text: node.title }],
        })
        continue
      }
      const level = Math.min(node.level + 1, 3)
      content.push({
        type: 'heading',
        attrs: { level, tocId: node.id },
        content: [{ type: 'text', text: node.title }],
      })
      walk(node.children)
    }
  }
  walk(toc)
  if (!content.length) {
    content.push({
      type: 'heading',
      attrs: { level: 2, tocId: OTHER_TOC_ID },
      content: [{ type: 'text', text: '기타' }],
    })
  }
  return { type: 'doc', content }
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  fileName: null,
  loading: false,
  error: null,
  pdfBytes: null,
  numPages: 0,
  pages: [],
  metadata: emptyMeta,
  toc: [],
  tocIndex: [],
  highlights: [],
  highlightColor: 'yellow',
  zoom: 1.45,
  pendingBullets: [],
  digestSeed: null,
  digestJson: null,
  loadGeneration: 0,
  scrollRequest: null,
  pdfTool: 'highlight',
  layoutMode: 'split',
  splitRatio: 0.6,
  pendingDeletes: [],
  digestTheme: readDigestTheme(),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  requestScroll: (pageIndex) => set({ scrollRequest: { pageIndex, nonce: Date.now() } }),
  clearScrollRequest: () => set({ scrollRequest: null }),
  consumeBullet: (id) =>
    set({ pendingBullets: get().pendingBullets.filter((b) => b.id !== id) }),
  consumeDelete: (id) =>
    set({ pendingDeletes: get().pendingDeletes.filter((x) => x !== id) }),
  setPdfTool: (pdfTool) => set({ pdfTool }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setSplitRatio: (ratio) => set({ splitRatio: Math.min(0.82, Math.max(0.18, ratio)) }),
  setDigestTheme: (digestTheme) => {
    try {
      localStorage.setItem('watch-pdf-digest-theme', digestTheme)
    } catch {
      /* 저장 불가해도 화면 테마는 바뀐다 */
    }
    set({ digestTheme })
  },
  removeHighlight: (id) => {
    const { highlights, pendingDeletes } = get()
    if (!highlights.some((h) => h.id === id)) return
    set({
      highlights: highlights.filter((h) => h.id !== id),
      pendingDeletes: pendingDeletes.includes(id) ? pendingDeletes : [...pendingDeletes, id],
    })
  },
  setDigestJson: (digestJson) => set({ digestJson }),

  loadFile: async (file) => {
    set({ loading: true, error: null })
    try {
      const pdfBytes = await file.arrayBuffer()
      const pdf = await openPdf(pdfBytes)
      const pages = await extractPages(pdf)
      const metadata = extractMetadata(pages)
      if (!metadata.title) metadata.title = file.name.replace(/\.pdf$/i, '')
      const toc = await extractToc(pdf, pages)
      const tocIndex = tocIndexFromTree(toc)
      const restored = await restoreEditingState(pdf, pdfBytes, pages, tocIndex)
      const numPages = pdf.numPages
      await pdf.cleanup()
      await pdf.loadingTask.destroy()
      const seed = restored.digest ?? seedFromToc(metadata, toc)
      set({
        fileName: file.name,
        pdfBytes,
        numPages,
        pages,
        metadata,
        toc,
        tocIndex,
        highlights: restored.highlights,
        pendingBullets: restored.pendingBullets,
        pendingDeletes: [],
        digestSeed: seed,
        digestJson: seed,
        loadGeneration: get().loadGeneration + 1,
        loading: false,
        error: null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF를 열 수 없습니다.'
      set({ loading: false, error: message })
    }
  },

  captureSelection: (pageIndex, quads, text, topY, midX) => {
    const { tocIndex, highlightColor, highlights, pdfTool, pages } = get()
    if (pdfTool !== 'highlight') return
    if (!tocIndex.length) return
    const pageWidth = pages[pageIndex]?.width ?? 612
    const col = midX < pageWidth / 2 ? 'left' : 'right'
    const toc = findNearestToc(pageIndex, topY, col, tocIndex)
    const id = crypto.randomUUID()
    const highlight: Highlight = {
      id,
      pageIndex,
      quads,
      color: highlightColor,
      text,
      tocId: toc.id,
    }
    const bullet: BulletInsert = {
      id,
      tocId: toc.id,
      text,
      pageNumber: pageIndex + 1,
    }
    set({
      highlights: [...highlights, highlight],
      pendingBullets: [...get().pendingBullets, bullet],
    })
  },
}))
