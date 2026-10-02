import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageText, PdfTextItem } from '../types'
import { orderTwoColumn } from './columnOrder'
import { pdfjsLib } from './pdfjs'

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) })
  return task.promise
}

export async function extractPages(pdf: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = []
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: PdfTextItem[] = []
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue
      const t = raw.transform
      const fontSize = Math.hypot(t[0], t[1])
      items.push({
        str: raw.str,
        pageIndex: i - 1,
        x: t[4],
        y: t[5],
        width: raw.width,
        height: raw.height || fontSize,
        fontSize,
      })
    }
    pages.push({
      pageIndex: i - 1,
      width: viewport.width,
      height: viewport.height,
      items: orderTwoColumn(items, viewport.width),
    })
  }
  return pages
}
