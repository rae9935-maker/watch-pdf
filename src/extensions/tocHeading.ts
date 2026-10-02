import Heading from '@tiptap/extension-heading'

export const TocHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tocId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-toc-id'),
        renderHTML: (attributes) =>
          attributes.tocId ? { 'data-toc-id': attributes.tocId } : {},
      },
    }
  },
})
