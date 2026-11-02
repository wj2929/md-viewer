import { type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { basicSetup } from 'codemirror'

export function createMarkdownEditorExtensions(extraExtensions: Extension[] = [], plainText = false): Extension[] {
  return [
    basicSetup,
    history(),
    ...(plainText ? [] : [markdown()]),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    ...extraExtensions,
  ]
}
