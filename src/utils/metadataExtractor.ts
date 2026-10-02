import type { Metadata, PageText } from '../types'
import { linesFromItems } from './columnOrder'

const EMPTY: Metadata = {
  title: '',
  subtitle: '',
  organization: '',
  series: '',
  issue: '',
  date: '',
  authors: '',
}

export function extractMetadata(pages: PageText[]): Metadata {
  const page = pages[0]
  if (!page) return { ...EMPTY }

  const cutoff = page.height * 0.75
  const headerItems = page.items.filter((it) => it.y >= cutoff)
  const footerItems = page.items.filter((it) => it.y <= page.height * 0.14)
  const scanItems = headerItems.length > 8 ? headerItems : page.items.slice(0, 80)
    const lines = linesFromItems(scanItems, page.width).filter((l) => l.text.length > 0)
    const footerLines = linesFromItems(footerItems, page.width).filter((l) => l.text.length > 0)
  const fullText = [...lines, ...footerLines].map((l) => l.text).join('\n')
  const allText = pages.map((p) => p.items.map((it) => it.str).join('')).join('\n')

  const meta: Metadata = { ...EMPTY }

  const orgMatch = fullText.match(/국회입법조사처|[가-힣A-Za-z]{2,20}(연구원|연구소|위원회|처|청)/)
  if (orgMatch) meta.organization = orgMatch[0]

  if (/이슈\s*와\s*논점/.test(allText)) meta.series = '이슈와 논점'

  const issueMatch = fullText.match(/제?\s*(\d{2,5})\s*호/)
  if (issueMatch) meta.issue = `제${issueMatch[1]}호`

  const dateMatch = fullText.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (dateMatch) {
    meta.date = `${dateMatch[1]}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3].padStart(2, '0')}`
  }

  const skip = (t: string) =>
    /이슈\s*와\s*논점|국회입법조사처|제\s*\d+\s*호|입법조사관|연구위원|ISSN|\d{4}[.\-/]/.test(t)

  const ranked = [...lines].sort((a, b) => b.fontSize - a.fontSize || b.y - a.y)
  const titleLine = ranked.find((l) => l.text.length >= 8 && l.text.length <= 90 && !skip(l.text))
  if (titleLine) {
    const idx = lines.indexOf(titleLine)
    const titleParts = [titleLine.text]
    let k = idx + 1
    while (k < lines.length) {
      const next = lines[k]
      if (!next || skip(next.text)) break
      if (/^[가-힣](\s+[가-힣]){1,3}$/.test(next.text) && next.text.length <= 12) break
      if (Math.abs(next.fontSize - titleLine.fontSize) > 1.2) break
      if (next.text.length < 4 || next.text.length > 90) break
      titleParts.push(next.text)
      k += 1
      if (titleParts.join(' ').length > 160) break
    }
    meta.title = titleParts.join(' ').replace(/\s+/g, ' ').trim()
    const after = lines[idx + titleParts.length]
    if (
      after &&
      (after.fontSize < titleLine.fontSize - 0.5 || /[‘'"「].+[’'"」]/.test(after.text))
    ) {
      if (!skip(after.text) && after.text.length <= 90 && after.text !== meta.title) {
        meta.subtitle = after.text.replace(/^[‘'"]|[’'"]$/g, '')
      }
    }
  }

  const authorBits: string[] = []
  const authorLines = [...lines, ...footerLines]
  for (let i = 0; i < authorLines.length; i += 1) {
    const t = authorLines[i].text
    if (/저자\s*\|/.test(t)) {
      authorBits.push(t.replace(/저자\s*\|/, '').trim())
    }
    const spaced = t.match(/^([가-힣]\s+){1,3}[가-힣]$/)
    if (spaced && authorLines[i].fontSize >= 10 && t.length <= 12) {
      authorBits.push(t.replace(/\s+/g, ''))
    }
    const footerName = t.match(/자\s*I\s*([가-힣]+)/)
    if (footerName) authorBits.push(footerName[1])
    if (/입법조사관|연구위원/.test(t)) {
      const prev = authorLines[i - 1]?.text ?? ''
      const nameLike = prev.length > 0 && prev.length < 40 && !skip(prev) ? prev : t
      if (!/입법조사관|연구위원/.test(nameLike)) authorBits.push(nameLike)
    }
  }
  meta.authors = [...new Set(authorBits.filter(Boolean))].join(', ')

  if (!meta.title) {
    meta.title = ranked.find((l) => l.text.length > 4)?.text ?? ''
  }

  return meta
}
