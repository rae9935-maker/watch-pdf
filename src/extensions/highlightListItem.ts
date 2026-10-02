import ListItem from '@tiptap/extension-list-item'

export const HighlightListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      highlightId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-highlight-id'),
        renderHTML: (attributes) =>
          attributes.highlightId ? { 'data-highlight-id': attributes.highlightId } : {},
      },
    }
  },
})
