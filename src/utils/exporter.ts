import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { JSONContent } from '@tiptap/core'
import type { Metadata } from '../types'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function inlineText(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') {
    let t = node.text ?? ''
    const marks = node.marks ?? []
    if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
    if (marks.some((m) => m.type === 'italic')) t = `*${t}*`
    const link = marks.find((m) => m.type === 'link')
    if (link?.attrs?.href) t = `[${node.text ?? ''}](${link.attrs.href})`
    return t
  }
  return (node.content ?? []).map(inlineText).join('')
}

export function jsonToMarkdown(doc: JSONContent, metadata: Metadata): string {
  const head: string[] = []
  if (metadata.title) head.push(`# ${metadata.title}`)
  const metaLines = [
    metadata.subtitle && `> ${metadata.subtitle}`,
    metadata.organization && `- 기관: ${metadata.organization}`,
    metadata.series && `- 시리즈: ${metadata.series}${metadata.issue ? ` ${metadata.issue}` : ''}`,
    metadata.date && `- 일자: ${metadata.date}`,
    metadata.authors && `- 저자: ${metadata.authors}`,
  ].filter(Boolean) as string[]
  if (metaLines.length) head.push(metaLines.join('\n'))

  const body: string[] = []
  const walk = (nodes: JSONContent[] | undefined) => {
    if (!nodes) return
    for (const node of nodes) {
      if (node.type === 'heading') {
        const level = Math.min(Number(node.attrs?.level ?? 2), 4)
        body.push(`${'#'.repeat(level)} ${inlineText(node)}`)
      } else if (node.type === 'paragraph') {
        const t = inlineText(node)
        if (t) body.push(t)
      } else if (node.type === 'bulletList') {
        for (const item of node.content ?? []) {
          body.push(`- ${inlineText(item)}`)
        }
      } else if (node.type === 'orderedList') {
        ;(node.content ?? []).forEach((item, i) => {
          body.push(`${i + 1}. ${inlineText(item)}`)
        })
      } else if (node.content) {
        walk(node.content)
      }
    }
  }
  walk(doc.content)
  return [...head, '', ...body].join('\n\n').trim() + '\n'
}

export function downloadMarkdown(markdown: string, filename: string) {
  downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename)
}

function textRunsFromNode(node: JSONContent): TextRun[] {
  if (node.type === 'text') {
    const marks = node.marks ?? []
    return [
      new TextRun({
        text: node.text ?? '',
        bold: marks.some((m) => m.type === 'bold'),
        italics: marks.some((m) => m.type === 'italic'),
      }),
    ]
  }
  return (node.content ?? []).flatMap(textRunsFromNode)
}

function paragraphsFromDoc(doc: JSONContent): Paragraph[] {
  const out: Paragraph[] = []
  const walk = (nodes: JSONContent[] | undefined) => {
    if (!nodes) return
    for (const node of nodes) {
      if (node.type === 'heading') {
        const level = Number(node.attrs?.level ?? 2)
        const heading =
          level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
        out.push(new Paragraph({ heading, children: textRunsFromNode(node) }))
      } else if (node.type === 'paragraph') {
        out.push(new Paragraph({ children: textRunsFromNode(node) }))
      } else if (node.type === 'bulletList') {
        for (const item of node.content ?? []) {
          out.push(
            new Paragraph({
              bullet: { level: 0 },
              children: textRunsFromNode(item),
            }),
          )
        }
      } else if (node.content) {
        walk(node.content)
      }
    }
  }
  walk(doc.content)
  return out
}

function metaRow(label: string, value: string) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2200, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
      }),
      new TableCell({
        width: { size: 7400, type: WidthType.DXA },
        children: [new Paragraph(value || '—')],
      }),
    ],
  })
}

export async function downloadDocx(docJson: JSONContent, metadata: Metadata, filename: string) {
  const table = new Table({
    width: { size: 9600, type: WidthType.DXA },
    rows: [
      metaRow('제목', metadata.title),
      metaRow('부제', metadata.subtitle),
      metaRow('기관', metadata.organization),
      metaRow('시리즈', [metadata.series, metadata.issue].filter(Boolean).join(' ')),
      metaRow('일자', metadata.date),
      metaRow('저자', metadata.authors),
    ],
  })

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun(metadata.title || 'Digest')],
          }),
          table,
          new Paragraph({ text: '' }),
          ...paragraphsFromDoc(docJson),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  downloadBlob(blob, filename)
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const copy = Uint8Array.from(bytes)
  downloadBlob(new Blob([copy.buffer], { type: mime }), filename)
}
