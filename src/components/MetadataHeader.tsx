import type { Metadata } from '../types'

export function MetadataHeader({ metadata }: { metadata: Metadata }) {
  const chips = [
    metadata.organization,
    [metadata.series, metadata.issue].filter(Boolean).join(' '),
    metadata.date,
    metadata.authors,
  ].filter(Boolean)

  return (
    <header className="digest-header px-4 py-3">
      <h1 className="text-base leading-snug font-semibold">{metadata.title || '제목 없음'}</h1>
      {metadata.subtitle ? <p className="digest-muted mt-1 text-sm">{metadata.subtitle}</p> : null}
      {chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="digest-chip rounded-full px-2 py-0.5 text-[11px]">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  )
}
