declare module 'wavedrom' {
  type OnmlNode = [string, Record<string, unknown>, ...unknown[]]

  const wavedrom: {
    waveSkin: Record<string, unknown>
    renderAny: (
      index: number,
      source: Record<string, unknown>,
      waveSkin: Record<string, unknown>,
      notFirstSignal?: boolean,
    ) => OnmlNode
    onml: {
      stringify: (node: OnmlNode) => string
    }
  }

  export default wavedrom
}
