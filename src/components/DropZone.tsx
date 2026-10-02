import { FileText, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useDocumentStore } from '../store/documentStore'

export function DropZone() {
  const loadFile = useDocumentStore((s) => s.loadFile)
  const loading = useDocumentStore((s) => s.loading)
  const error = useDocumentStore((s) => s.error)
  const [over, setOver] = useState(false)

  const onFile = useCallback(
    (file: File | undefined) => {
      if (file?.type === 'application/pdf' || file?.name.toLowerCase().endsWith('.pdf')) {
        void loadFile(file)
      }
    },
    [loadFile],
  )

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-[#1a1c22] px-6 text-stone-200">
      <label
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-10 py-16 text-center transition ${
          over ? 'border-amber-400 bg-amber-400/10' : 'border-stone-600 bg-stone-900/40 hover:border-stone-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFile(e.dataTransfer.files[0])
        }}
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-amber-400/15 text-amber-300">
          {loading ? <Upload className="h-7 w-7 animate-pulse" /> : <FileText className="h-7 w-7" />}
        </span>
        <div>
          <p className="text-lg font-medium tracking-tight text-white">PDF를 여기에 놓으세요</p>
          <p className="mt-1 text-sm text-stone-400">
            이슈와 논점·정책 보고서·2단 논문. 하이라이트하면 오른쪽 목차에 붙습니다.
          </p>
        </div>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-stone-900">
          {loading ? '읽는 중…' : '파일 선택'}
        </span>
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      </label>
      <button
        type="button"
        className="mt-4 text-sm text-stone-400 underline-offset-2 hover:text-amber-300 hover:underline"
        onClick={() => {
          void (async () => {
            const res = await fetch(`${import.meta.env.BASE_URL}sample.pdf`)
            if (!res.ok) return
            const blob = await res.blob()
            const file = new File([blob], 'sample.pdf', { type: 'application/pdf' })
            await loadFile(file)
          })()
        }}
      >
        이슈와 논점 샘플 열기
      </button>
    </div>
  )
}
