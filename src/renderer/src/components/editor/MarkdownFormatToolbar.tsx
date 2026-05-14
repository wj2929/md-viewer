import type { MarkdownFormatCommand } from './markdownFormatCommands'

interface MarkdownFormatToolbarProps {
  disabled: boolean
  onCommand: (command: MarkdownFormatCommand) => void
}

const FORMAT_ACTIONS: Array<{ command: MarkdownFormatCommand; label: string; title: string }> = [
  { command: 'bold', label: 'B', title: '加粗' },
  { command: 'italic', label: 'I', title: '斜体' },
  { command: 'inlineCode', label: '`', title: '行内代码' },
  { command: 'link', label: '[]()', title: '链接' },
  { command: 'heading', label: 'H2', title: '二级标题' },
  { command: 'bulletList', label: '-', title: '无序列表' },
  { command: 'quote', label: '>', title: '引用' },
  { command: 'codeBlock', label: '{}', title: '代码块' },
]

export function MarkdownFormatToolbar({ disabled, onCommand }: MarkdownFormatToolbarProps): JSX.Element {
  return (
    <div className="markdown-format-toolbar" aria-label="Markdown 格式工具">
      {FORMAT_ACTIONS.map(action => (
        <button
          key={action.command}
          type="button"
          title={action.title}
          aria-label={action.title}
          disabled={disabled}
          onClick={() => onCommand(action.command)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
