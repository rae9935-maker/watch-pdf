import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { Download, Eraser, Highlighter, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { clampZoom, HIGHLIGHT_COLORS, useDocumentStore } from '../store/documentStore'
import type { Highlight, HighlightColorId } from '../types'
import { markFootnoteSpans, quadsToCssRects, selectionToQuads } from '../utils/highlightCoords'
import { downloadBytes } from '../utils/exporter'
import { openPdf } from '../utils/pdfLoader'
import { buildAnnotatedPdf } from '../utils/pdfAnnotator'
import { pdfjsLib } from '../utils/pdfjs'

type PageView = {
  page: PDFPageProxy
  viewport: PageViewport
}

type ZoomAnchor = {
  ratioX: number
  ratioY: number
  viewX: number
  viewY: number
}

const pageRenderChain = new WeakMap<PDFPageProxy, Promise<void>>()

const gestureFlag = { active: false }

function gestureActive() {
  return gestureFlag.active
}

function renderPixelRatio(cssWidth: number, cssHeight: number) {
  const desired = Math.max(window.devicePixelRatio || 1, 2)
  const cap = Math.min(8192 / Math.max(cssWidth, 1), 8192 / Math.max(cssHeight, 1))
  return Math.max(1, Math.min(desired, cap))
}

function PdfPageView({
  pageNumber,
  view,
  highlights,
  onReady,
}: {
  pageNumber: number
  view: PageView
  highlights: Highlight[]
  onReady: (pageNumber: number, el: HTMLDivElement | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const captureSelection = useDocumentStore((s) => s.captureSelection)
  const pdfTool = useDocumentStore((s) => s.pdfTool)
  const removeHighlight = useDocumentStore((s) => s.removeHighlight)

  useEffect(() => {
    const canvas = canvasRef.current
    const textLayerDiv = textRef.current
    if (!canvas || !textLayerDiv) return

    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined
    let textLayer: InstanceType<typeof pdfjsLib.TextLayer> | undefined
    const { page, viewport } = view
    const previous = pageRenderChain.get(page) ?? Promise.resolve()
    const job = previous.then(async () => {
      if (cancelled) return
      const pixelRatio = renderPixelRatio(viewport.width, viewport.height)
      canvas.width = Math.round(viewport.width * pixelRatio)
      canvas.height = Math.round(viewport.height * pixelRatio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      textLayerDiv.replaceChildren()
      textLayerDiv.style.width = `${viewport.width}px`
      textLayerDiv.style.height = `${viewport.height}px`
      textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale))
      textLayerDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
      renderTask = page.render({
        canvas,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        annotationMode: 0,
      })
      try {
        await renderTask.promise
        if (cancelled) return
        const textContent = await page.getTextContent()
        if (cancelled) return
        textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return
        markFootnoteSpans(textLayerDiv, viewport.scale)
      } catch {
        /* 배율이 바뀌면 진행 중 렌더는 취소된다 */
      }
    })
    pageRenderChain.set(page, job.then(() => {}, () => {}))

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [view])

  useEffect(() => {
    onReady(pageNumber, wrapRef.current)
    return () => onReady(pageNumber, null)
  }, [onReady, pageNumber])

  const onMouseUp = (event: ReactMouseEvent) => {
    if (event.ctrlKey || gestureActive()) return
    const pageEl = wrapRef.current
    if (!pageEl) return
    const mapped = selectionToQuads(pageEl, view.viewport)
    if (!mapped) return
    captureSelection(pageNumber - 1, mapped.quads, mapped.text, mapped.topY, mapped.midX)
    window.getSelection()?.removeAllRanges()
  }

  const onContextMenu = (event: ReactMouseEvent) => {
    const pageEl = wrapRef.current
    if (!pageEl) return
    const boxes = [...pageEl.querySelectorAll<HTMLElement>('[data-highlight-id]')]
    for (let i = boxes.length - 1; i >= 0; i -= 1) {
      const box = boxes[i]
      const rect = box.getBoundingClientRect()
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      if (!inside) continue
      event.preventDefault()
      event.stopPropagation()
      const id = box.dataset.highlightId
      if (id) removeHighlight(id)
      return
    }
  }

  const pageHighlights = highlights.filter((h) => h.pageIndex === pageNumber - 1)

  return (
    <div
      ref={wrapRef}
      data-page={pageNumber}
      className="relative mb-4 bg-white shadow-md"
      style={{ width: view.viewport.width, height: view.viewport.height }}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="pdf-canvas block" />
      <div
        className={`absolute inset-0 ${pdfTool === 'eraser' ? 'z-10' : 'pointer-events-none'}`}
      >
        {pageHighlights.map((h) =>
          quadsToCssRects(h.quads, view.viewport).map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              data-highlight-id={h.id}
              className={`absolute ${pdfTool === 'eraser' ? 'cursor-pointer' : ''}`}
              title={pdfTool === 'eraser' ? '클릭하여 하이라이트 삭제' : '우클릭하여 하이라이트 삭제'}
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                background: HIGHLIGHT_COLORS[h.color].css,
              }}
              onMouseDown={(e) => {
                if (pdfTool !== 'eraser') return
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={(e) => {
                if (pdfTool !== 'eraser') return
                e.preventDefault()
                e.stopPropagation()
                removeHighlight(h.id)
              }}
            />
          )),
        )}
      </div>
      <div ref={textRef} className="textLayer" />
    </div>
  )
}

export function PdfViewer() {
  const pdfBytes = useDocumentStore((s) => s.pdfBytes)
  const numPages = useDocumentStore((s) => s.numPages)
  const zoom = useDocumentStore((s) => s.zoom)
  const setZoom = useDocumentStore((s) => s.setZoom)
  const highlights = useDocumentStore((s) => s.highlights)
  const highlightColor = useDocumentStore((s) => s.highlightColor)
  const setHighlightColor = useDocumentStore((s) => s.setHighlightColor)
  const pdfTool = useDocumentStore((s) => s.pdfTool)
  const setPdfTool = useDocumentStore((s) => s.setPdfTool)
  const fileName = useDocumentStore((s) => s.fileName)
  const digestJson = useDocumentStore((s) => s.digestJson)
  const scrollRequest = useDocumentStore((s) => s.scrollRequest)
  const clearScrollRequest = useDocumentStore((s) => s.clearScrollRequest)

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [views, setViews] = useState<PageView[]>([])
  const [pageInput, setPageInput] = useState(1)
  const [liveZoom, setLiveZoom] = useState<number | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map())
  const anchorRef = useRef<ZoomAnchor | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    if (!pdfBytes) {
      setPdf(null)
      return
    }
    let cancelled = false
    let doc: PDFDocumentProxy | undefined
    void openPdf(pdfBytes).then((opened) => {
      if (cancelled) {
        void opened.cleanup().then(() => opened.loadingTask.destroy())
        return
      }
      doc = opened
      setPdf(opened)
    })
    return () => {
      cancelled = true
      if (!doc) return
      const closing = doc
      void closing.cleanup().then(() => closing.loadingTask.destroy())
    }
  }, [pdfBytes])

  useEffect(() => {
    if (!pdf) {
      setViews([])
      return
    }
    let cancelled = false
    void (async () => {
      const next: PageView[] = []
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i)
        next.push({ page, viewport: page.getViewport({ scale: zoom }) })
      }
      if (!cancelled) setViews(next)
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, zoom])

  useEffect(() => {
    const scroller = scrollerRef.current
    const stack = stackRef.current
    if (!scroller || !stack) return

    let dragging = false
    let startY = 0
    let startZoom = zoomRef.current
    let preview = startZoom
    let originX = 0
    let originY = 0
    let wheelTimer = 0
    let wheelBase = 0
    let wheelPreview = 0
    let lastX = 0
    let lastY = 0

    const paint = (base: number, next: number) => {
      preview = clampZoom(next)
      const ratio = preview / base
      stack.style.transformOrigin = `${originX}px ${originY}px`
      stack.style.transform = Math.abs(ratio - 1) < 0.001 ? '' : `scale(${ratio})`
      setLiveZoom(Math.abs(preview - zoomRef.current) < 0.001 ? null : preview)
    }

    const rememberAnchor = (clientX: number, clientY: number) => {
      const rect = stack.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      anchorRef.current = {
        ratioX: (clientX - rect.left) / rect.width,
        ratioY: (clientY - rect.top) / rect.height,
        viewX: clientX - scrollerRect.left,
        viewY: clientY - scrollerRect.top,
      }
    }

    const commit = (clientX: number, clientY: number) => {
      rememberAnchor(clientX, clientY)
      gestureFlag.active = false
      document.body.style.cursor = ''
      setLiveZoom(null)
      if (Math.abs(preview - zoomRef.current) > 0.001) {
        setZoom(preview)
        return
      }
      stack.style.transform = ''
      stack.style.transformOrigin = ''
      anchorRef.current = null
    }

    const onDown = (event: MouseEvent) => {
      if (!event.ctrlKey || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragging = true
      gestureFlag.active = true
      startY = event.clientY
      startZoom = zoomRef.current
      preview = startZoom
      lastX = event.clientX
      lastY = event.clientY
      const rect = stack.getBoundingClientRect()
      originX = event.clientX - rect.left
      originY = event.clientY - rect.top
      document.body.style.cursor = 'ns-resize'
    }

    const onMove = (event: MouseEvent) => {
      if (!dragging) return
      event.preventDefault()
      lastX = event.clientX
      lastY = event.clientY
      paint(startZoom, startZoom * 2 ** ((startY - event.clientY) / 220))
    }

    const onUp = (event: MouseEvent) => {
      if (!dragging) return
      dragging = false
      commit(event.clientX, event.clientY)
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || dragging) return
      event.preventDefault()
      const delta =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * scroller.clientHeight : event.deltaY
      if (!wheelTimer) {
        wheelBase = zoomRef.current
        wheelPreview = wheelBase
        const rect = stack.getBoundingClientRect()
        originX = event.clientX - rect.left
        originY = event.clientY - rect.top
        gestureFlag.active = true
      }
      lastX = event.clientX
      lastY = event.clientY
      wheelPreview = clampZoom(wheelPreview * Math.exp(-delta * 0.0018))
      preview = wheelPreview
      paint(wheelBase, wheelPreview)
      window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        wheelTimer = 0
        startZoom = wheelBase
        preview = wheelPreview
        commit(lastX, lastY)
      }, 140)
    }

    scroller.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      gestureFlag.active = false
      document.body.style.cursor = ''
      window.clearTimeout(wheelTimer)
      scroller.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [setZoom])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const scroller = scrollerRef.current
    const stack = stackRef.current
    if (!anchor || !scroller || !stack) return
    stack.style.transform = ''
    stack.style.transformOrigin = ''
    const scrollerRect = scroller.getBoundingClientRect()
    const stackRect = stack.getBoundingClientRect()
    const contentLeft = scroller.scrollLeft + (stackRect.left - scrollerRect.left)
    const contentTop = scroller.scrollTop + (stackRect.top - scrollerRect.top)
    scroller.scrollLeft = contentLeft + anchor.ratioX * stackRect.width - anchor.viewX
    scroller.scrollTop = contentTop + anchor.ratioY * stackRect.height - anchor.viewY
    anchorRef.current = null
  }, [views])

  useEffect(() => {
    if (!scrollRequest) return
    const el = pageEls.current.get(scrollRequest.pageIndex + 1)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    clearScrollRequest()
  }, [scrollRequest, clearScrollRequest])

  const onReady = (pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(pageNumber, el)
    else pageEls.current.delete(pageNumber)
  }

  const jump = (n: number) => {
    const page = Math.min(numPages, Math.max(1, n))
    setPageInput(page)
    pageEls.current.get(page)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onScroll = () => {
    const root = scrollerRef.current
    if (!root) return
    const mid = root.getBoundingClientRect().top + 80
    let current = 1
    for (const [n, el] of pageEls.current) {
      if (el.getBoundingClientRect().top <= mid) current = n
    }
    setPageInput(current)
  }

  const exportPdf = async () => {
    if (!pdfBytes) return
    const bytes = await buildAnnotatedPdf(pdfBytes, highlights, digestJson)
    const base = (fileName ?? 'document').replace(/\.pdf$/i, '')
    downloadBytes(bytes, `${base}-highlighted.pdf`, 'application/pdf')
  }

  const colors: HighlightColorId[] = ['yellow', 'green', 'pink']

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#2b2d33]">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/30 bg-[#1f2126] px-3 py-2 text-stone-200">
        <Highlighter className="h-4 w-4 text-amber-300" />
        <button
          type="button"
          title="하이라이트"
          onClick={() => setPdfTool('highlight')}
          className={`rounded p-1 ${pdfTool === 'highlight' ? 'bg-white/15' : 'hover:bg-white/10'}`}
        >
          <Highlighter className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="지우개"
          onClick={() => setPdfTool('eraser')}
          className={`rounded p-1 ${pdfTool === 'eraser' ? 'bg-white/15' : 'hover:bg-white/10'}`}
        >
          <Eraser className="h-4 w-4" />
        </button>
        <div className="flex gap-1">
          {colors.map((id) => (
            <button
              key={id}
              type="button"
              title={id}
              onClick={() => setHighlightColor(id)}
              className={`h-5 w-5 rounded-full border-2 ${
                highlightColor === id ? 'border-white' : 'border-transparent'
              }`}
              style={{ background: HIGHLIGHT_COLORS[id].swatch }}
            />
          ))}
        </div>
        <div className="mx-2 h-4 w-px bg-stone-600" />
        <button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setZoom(zoom - 0.1)}>
          <Minus className="h-4 w-4" />
        </button>
        <span
          title="Ctrl을 누른 채 위·아래로 드래그하거나 Ctrl+휠로 PDF를 확대·축소합니다"
          className="w-12 text-center text-xs tabular-nums"
        >
          {Math.round((liveZoom ?? zoom) * 100)}%
        </span>
        <button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setZoom(zoom + 0.1)}>
          <Plus className="h-4 w-4" />
        </button>
        <div className="mx-2 h-4 w-px bg-stone-600" />
        <input
          type="number"
          min={1}
          max={numPages || 1}
          value={pageInput}
          onChange={(e) => jump(Number(e.target.value))}
          className="w-12 rounded bg-black/40 px-1 py-0.5 text-center text-xs"
        />
        <span className="text-xs text-stone-400">/ {numPages || '—'}</span>
        <button
          type="button"
          onClick={() => void exportPdf()}
          className="ml-auto inline-flex items-center gap-1 rounded bg-amber-300 px-2 py-1 text-xs font-medium text-stone-900 hover:bg-amber-200"
        >
          <Download className="h-3.5 w-3.5" />
          하이라이트 PDF
        </button>
      </div>
      <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <div ref={stackRef} className="mx-auto flex w-fit flex-col items-center">
          {views.map((view, i) => (
            <PdfPageView
              key={i}
              pageNumber={i + 1}
              view={view}
              highlights={highlights}
              onReady={onReady}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
