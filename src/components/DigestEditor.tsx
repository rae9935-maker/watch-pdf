import type { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Copy, FileDown, FileText, Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { HighlightListItem } from '../extensions/highlightListItem'
import { TocHeading } from '../extensions/tocHeading'
import { useDocumentStore } from '../store/documentStore'
import { OTHER_TOC_ID } from '../types'
import { downloadDocx, downloadMarkdown, jsonToMarkdown } from '../utils/exporter'
import { MetadataHeader } from './MetadataHeader'

function insertBullet(editor: Editor, tocId: string, text: string, pageNumber: number, highlightId: string) {
  const { doc } = editor.state
  let headingPos: number | null = null
  let headingSize = 0
  let fallbackPos: number | null = null
  let fallbackSize = 0

  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    if (node.attrs.tocId === tocId) {
      headingPos = pos
      headingSize = node.nodeSize
    }
    if (node.attrs.tocId === OTHER_TOC_ID) {
      fallbackPos = pos
      fallbackSize = node.nodeSize
    }
  })

  const start = headingPos ?? fallbackPos
  const size = headingPos != null ? headingSize : fallbackSize
  if (start == null) return

  const after = start + size
  const listItem = {
    type: 'listItem',
    attrs: { highlightId },
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${text} ` },
          {
            type: 'text',
            text: `(p.${pageNumber})`,
            marks: [{ type: 'link', attrs: { href: `#page-${pageNumber}` } }],
          },
        ],
      },
    ],
  }

  const next = doc.nodeAt(after)
  if (next?.type.name === 'bulletList') {
    editor.commands.insertContentAt(after + next.nodeSize - 1, listItem)
  } else {
    editor.commands.insertContentAt(after, { type: 'bulletList', content: [listItem] })
  }
}

function removeBullet(editor: Editor, highlightId: string) {
  const { doc } = editor.state
  let from = -1
  let to = -1
  doc.descendants((node, pos) => {
    if (from >= 0) return false
    if (node.type.name === 'bulletList') {
      let childPos = pos + 1
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i)
        if (child.type.name === 'listItem' && child.attrs.highlightId === highlightId) {
          if (node.childCount === 1) {
            from = pos
            to = pos + node.nodeSize
          } else {
            from = childPos
            to = childPos + child.nodeSize
          }
          return false
        }
        childPos += child.nodeSize
      }
    }
  })
  if (from >= 0) editor.commands.deleteRange({ from, to })
}

export function DigestEditor() {
  const digestSeed = useDocumentStore((s) => s.digestSeed)
  const loadGeneration = useDocumentStore((s) => s.loadGeneration)
  const pendingBullets = useDocumentStore((s) => s.pendingBullets)
  const consumeBullet = useDocumentStore((s) => s.consumeBullet)
  const pendingDeletes = useDocumentStore((s) => s.pendingDeletes)
  const consumeDelete = useDocumentStore((s) => s.consumeDelete)
  const setDigestJson = useDocumentStore((s) => s.setDigestJson)
  const metadata = useDocumentStore((s) => s.metadata)
  const fileName = useDocumentStore((s) => s.fileName)
  const requestScroll = useDocumentStore((s) => s.requestScroll)
  const digestTheme = useDocumentStore((s) => s.digestTheme)
  const setDigestTheme = useDocumentStore((s) => s.setDigestTheme)

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: false,
          link: false,
          listItem: false,
        }),
        TocHeading.configure({ levels: [1, 2, 3] }),
        HighlightListItem,
        Link.configure({
          openOnClick: false,
          autolink: false,
        }),
        Placeholder.configure({ placeholder: '하이라이트하거나 직접 메모하세요' }),
      ],
      content: digestSeed ?? undefined,
      editorProps: {
        attributes: {
          class: 'digest-prose outline-none min-h-full px-4 py-3',
        },
        handleClick: (_view, _pos, event) => {
          const target = event.target as HTMLElement
          const a = target.closest('a')
          const href = a?.getAttribute('href') ?? ''
          const match = href.match(/#page-(\d+)/)
          if (match) {
            event.preventDefault()
            requestScroll(Number(match[1]) - 1)
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: ed }) => {
        setDigestJson(ed.getJSON())
      },
    },
    [loadGeneration],
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.commands || !digestSeed) return
    editor.commands.setContent(digestSeed)
    setDigestJson(editor.getJSON())
  }, [digestSeed, loadGeneration, editor, setDigestJson])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.commands || !pendingBullets.length) return
    for (const bullet of pendingBullets) {
      insertBullet(editor, bullet.tocId, bullet.text, bullet.pageNumber, bullet.id)
      consumeBullet(bullet.id)
    }
    setDigestJson(editor.getJSON())
  }, [pendingBullets, editor, consumeBullet, setDigestJson])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.commands || !pendingDeletes.length) return
    for (const id of pendingDeletes) {
      removeBullet(editor, id)
      consumeDelete(id)
    }
    setDigestJson(editor.getJSON())
  }, [pendingDeletes, editor, consumeDelete, setDigestJson])

  const base = (fileName ?? 'digest').replace(/\.pdf$/i, '')

  const exportMd = async (copy: boolean) => {
    if (!editor) return
    const md = jsonToMarkdown(editor.getJSON(), metadata)
    if (copy) {
      await navigator.clipboard.writeText(md)
      return
    }
    downloadMarkdown(md, `${base}-digest.md`)
  }

  const exportDocx = async () => {
    if (!editor) return
    await downloadDocx(editor.getJSON(), metadata, `${base}-digest.docx`)
  }

  return (
    <div data-theme={digestTheme} className="digest-shell flex h-full min-h-0 flex-col">
      <MetadataHeader metadata={metadata} />
      <div className="min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
      <div className="digest-toolbar flex shrink-0 gap-2 px-3 py-2">
        <button
          type="button"
          data-active={digestTheme === 'light'}
          onClick={() => setDigestTheme('light')}
          className="digest-btn inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        >
          <Sun className="h-3.5 w-3.5" />
          White
        </button>
        <button
          type="button"
          data-active={digestTheme === 'dark'}
          onClick={() => setDigestTheme('dark')}
          className="digest-btn inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        >
          <Moon className="h-3.5 w-3.5" />
          Dark
        </button>
        <button
          type="button"
          onClick={() => void exportMd(false)}
          className="digest-btn ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        >
          <FileText className="h-3.5 w-3.5" />
          Markdown
        </button>
        <button
          type="button"
          onClick={() => void exportMd(true)}
          className="digest-btn inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        >
          <Copy className="h-3.5 w-3.5" />
          MD 복사
        </button>
        <button
          type="button"
          onClick={() => void exportDocx()}
          className="digest-btn-primary ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
        >
          <FileDown className="h-3.5 w-3.5" />
          Word
        </button>
      </div>
    </div>
  )
}
