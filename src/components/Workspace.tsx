import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Columns2, FileText, PanelLeft } from 'lucide-react'
import { DropZone } from './DropZone'
import { DigestEditor } from './DigestEditor'
import { PdfViewer } from './PdfViewer'
import { useDocumentStore } from '../store/documentStore'
import type { LayoutMode } from '../types'

export function Workspace() {
  const pdfBytes = useDocumentStore((s) => s.pdfBytes)
  const loading = useDocumentStore((s) => s.loading)
  const layoutMode = useDocumentStore((s) => s.layoutMode)
  const setLayoutMode = useDocumentStore((s) => s.setLayoutMode)
  const splitRatio = useDocumentStore((s) => s.splitRatio)
  const setSplitRatio = useDocumentStore((s) => s.setSplitRatio)
  const boxRef = useRef<HTMLDivElement>(null)

  const onDrag = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      const box = boxRef.current
      if (!box) return
      const move = (e: globalThis.MouseEvent) => {
        const rect = box.getBoundingClientRect()
        setSplitRatio((e.clientX - rect.left) / rect.width)
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [setSplitRatio],
  )

  if (!pdfBytes && !loading) return <DropZone />
  if (!pdfBytes) return <DropZone />

  const modes: { id: LayoutMode; label: string; icon: typeof PanelLeft }[] = [
    { id: 'pdf', label: '원본만', icon: PanelLeft },
    { id: 'split', label: '분할', icon: Columns2 },
    { id: 'digest', label: '요약만', icon: FileText },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-black/20 bg-[#14151a] px-2 py-1">
        {modes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setLayoutMode(id)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              layoutMode === id ? 'bg-amber-300 text-stone-900' : 'text-stone-300 hover:bg-white/10'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div ref={boxRef} className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 min-w-0 ${layoutMode === 'digest' ? 'hidden' : ''}`}
          style={
            layoutMode === 'split'
              ? { width: `${splitRatio * 100}%` }
              : layoutMode === 'pdf'
                ? { width: '100%' }
                : undefined
          }
        >
          <PdfViewer />
        </div>
        {layoutMode === 'split' ? (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onDrag}
            className="w-1.5 shrink-0 cursor-col-resize bg-[#3a3d45] hover:bg-amber-400"
          />
        ) : null}
        <div
          className={`min-h-0 min-w-0 ${layoutMode === 'pdf' ? 'hidden' : ''}`}
          style={
            layoutMode === 'split'
              ? { width: `${(1 - splitRatio) * 100}%` }
              : layoutMode === 'digest'
                ? { width: '100%' }
                : undefined
          }
        >
          <DigestEditor />
        </div>
      </div>
    </div>
  )
}
