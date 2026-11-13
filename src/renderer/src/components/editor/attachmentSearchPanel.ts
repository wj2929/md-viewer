import { Prec } from '@codemirror/state'
import { EditorView, keymap, type Panel } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, search, SearchQuery, setSearchQuery } from '@codemirror/search'
import type { AttachmentSearchRequest } from '../../utils/attachmentSearch'

const panels = new WeakMap<EditorView, (backward: boolean) => void>()

function createAttachmentSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-search'
  const input = document.createElement('input')
  input.name = 'search'
  input.className = 'cm-textfield'
  input.placeholder = view.state.phrase('Find')
  input.setAttribute('aria-label', view.state.phrase('Find'))
  input.setAttribute('main-field', 'true')
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  const checks = new Map<string, HTMLInputElement>()
  let worker: Worker | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let query = getSearchQuery(view.state)
  let destroyed = false
  const cancel = () => {
    worker?.terminate()
    worker = undefined
    clearTimeout(timer)
    status.textContent = ''
    dom.removeAttribute('aria-busy')
  }
  const find = (backward: boolean) => {
    cancel()
    query = getSearchQuery(view.state)
    if (!query.valid) return
    const document = view.state.doc
    if (document.length < 512 * 1024) {
      ;(backward ? findPrevious : findNext)(view)
      return
    }
    const { from, to } = view.state.selection.main
    const request: AttachmentSearchRequest = {
      content: document.toString(), from, to, backward,
      wordChars: view.state.languageDataAt<string>('wordChars', view.state.selection.main.head).join(''),
      query: { search: query.search, caseSensitive: query.caseSensitive, literal: query.literal, regexp: query.regexp, wholeWord: query.wholeWord },
    }
    try {
      const active = new Worker(new URL('../../workers/attachmentSearchWorker.ts', import.meta.url), { type: 'module' })
      worker = active
      status.textContent = '正在查找…'
      dom.setAttribute('aria-busy', 'true')
      timer = setTimeout(() => { cancel(); status.textContent = '查找超时，请缩小表达式后重试。' }, 30_000)
      active.onmessage = (event: MessageEvent<{ from: number; to: number } | null>) => {
        if (destroyed || worker !== active || view.state.doc !== document || !getSearchQuery(view.state).eq(query)) return
        cancel()
        const match = event.data
        if (!match) { status.textContent = '未找到'; return }
        view.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }), userEvent: 'select.search' })
      }
      active.onerror = () => { if (worker === active) { cancel(); status.textContent = '查找失败，请重试。' } }
      active.postMessage(request)
    } catch {
      cancel()
      status.textContent = '查找不可用，请重试。'
    }
  }
  const updateQuery = () => {
    cancel()
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({
      search: input.value, literal: query.literal,
      caseSensitive: checks.get('case')!.checked,
      regexp: checks.get('re')!.checked,
      wholeWord: checks.get('word')!.checked,
    })) })
  }
  input.oninput = updateQuery
  input.onchange = updateQuery
  dom.append(input)
  for (const [name, label, backward] of [['next', 'next', false], ['prev', 'previous', true]] as const) {
    const button = document.createElement('button')
    button.name = name
    button.className = 'cm-button'
    button.textContent = view.state.phrase(label)
    button.onclick = () => find(backward)
    dom.append(button)
  }
  for (const [name, label] of [['case', 'match case'], ['re', 'regexp'], ['word', 'by word']]) {
    const wrapper = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.name = name
    checkbox.type = 'checkbox'
    checkbox.onchange = updateQuery
    checks.set(name, checkbox)
    wrapper.append(checkbox, view.state.phrase(label))
    dom.append(wrapper)
  }
  const close = document.createElement('button')
  close.name = 'close'
  close.setAttribute('aria-label', view.state.phrase('close'))
  close.textContent = '×'
  close.onclick = () => closeSearchPanel(view)
  dom.append(status, close)
  dom.onkeydown = event => {
    if (event.key === 'Enter' || event.key === 'F3' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      event.stopPropagation()
      find(event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSearchPanel(view)
      view.focus()
    }
  }
  const sync = () => {
    input.value = query.search
    checks.get('case')!.checked = query.caseSensitive
    checks.get('re')!.checked = query.regexp
    checks.get('word')!.checked = query.wholeWord
  }
  sync()
  panels.set(view, find)
  return {
    dom,
    mount() { input.focus(); input.select() },
    update(update) {
      const current = getSearchQuery(update.state)
      if (update.selectionSet && worker) cancel()
      if (update.docChanged || !current.eq(query)) {
        cancel()
        query = current
        sync()
      }
    },
    destroy() { destroyed = true; cancel(); panels.delete(view) },
  }
}

function findFromEditor(view: EditorView, backward: boolean): boolean {
  if (!panels.has(view)) openSearchPanel(view)
  panels.get(view)?.(backward)
  return true
}

export const attachmentSearch = [
  search({ createPanel: createAttachmentSearchPanel }),
  Prec.highest(keymap.of([
    { key: 'Mod-g', run: view => findFromEditor(view, false) },
    { key: 'Shift-Mod-g', run: view => findFromEditor(view, true) },
    { key: 'F3', run: view => findFromEditor(view, false), shift: view => findFromEditor(view, true) },
  ])),
]
