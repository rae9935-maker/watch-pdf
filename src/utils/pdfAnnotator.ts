import type { JSONContent } from '@tiptap/core'
import { PDFDocument, PDFHexString } from 'pdf-lib'
import { HIGHLIGHT_COLORS, type Highlight } from '../types'
import { detachSession, SESSION_FILENAME, stripWatchAnnots } from './watchSession'

function boundsOf(quads: number[][]): [number, number, number, number] {
  const xs: number[] = []
  const ys: number[] = []
  for (const quad of quads) {
    for (let i = 0; i < 8; i += 2) {
      xs.push(quad[i])
      ys.push(quad[i + 1])
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export async function buildAnnotatedPdf(
  source: ArrayBuffer,
  highlights: Highlight[],
  digest: JSONContent | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source.slice(0), { updateMetadata: false })
  stripWatchAnnots(pdf)
  detachSession(pdf)

  const pages = pdf.getPages()
  for (const h of highlights) {
    const page = pages[h.pageIndex]
    if (!page || !h.quads.length) continue
    const annot = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: boundsOf(h.quads),
      QuadPoints: h.quads.flat(),
      C: HIGHLIGHT_COLORS[h.color].pdf,
      CA: 0.45,
      T: PDFHexString.fromText('watch-pdf'),
      Contents: PDFHexString.fromText(h.text),
      WatchId: PDFHexString.fromText(h.id),
    })
    page.node.addAnnot(pdf.context.register(annot))
  }

  const session = JSON.stringify({ v: 1, highlights, digest })
  await pdf.attach(new TextEncoder().encode(session), SESSION_FILENAME, {
    mimeType: 'application/json',
    description: 'watch-pdf editing session',
  })

  return pdf.save()
}
