export type RemoteChartPolicy = 'prompt' | 'allow' | 'block'

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  element.textContent = text
  return element
}

export function createRemoteChartError(
  block: Element,
  rendererType: string,
  rendererName: string,
  blockIndex: number,
  message: string,
  retry?: () => Promise<HTMLElement>,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = `${rendererType}-wrapper remote-chart-failure`
  wrapper.dataset.remoteRenderer = rendererType
  wrapper.dataset.remoteBlockIndex = String(blockIndex)
  wrapper.setAttribute('role', 'group')
  wrapper.setAttribute('aria-label', `${rendererName} 渲染失败`)

  const error = document.createElement('div')
  error.className = `${rendererType}-error remote-chart-error`
  error.setAttribute('role', 'alert')
  error.appendChild(createTextElement('strong', 'error-title', `${rendererName} 渲染失败`))
  error.appendChild(createTextElement('span', 'error-message', message))
  if (retry) {
    const retryButton = createTextElement('button', 'remote-chart-retry-button no-export', '重试当前图表')
    retryButton.type = 'button'
    retryButton.addEventListener('click', async () => {
      if (retryButton.disabled || !wrapper.isConnected) return
      retryButton.disabled = true
      retryButton.textContent = '正在重试…'
      try {
        const rendered = await retry()
        if (wrapper.isConnected) wrapper.replaceWith(rendered)
      } catch (retryError) {
        if (!wrapper.isConnected) return
        const errorMessage = error.querySelector<HTMLElement>('.error-message')
        if (errorMessage) errorMessage.textContent = retryError instanceof Error ? retryError.message : String(retryError)
        retryButton.disabled = false
        retryButton.textContent = '重试当前图表'
      }
    })
    error.appendChild(retryButton)
  }
  wrapper.appendChild(error)
  block.replaceWith(wrapper)
  wrapper.appendChild(block)
  return wrapper
}
