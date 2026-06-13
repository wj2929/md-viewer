import { getRegisteredCapabilities } from './capabilitiesRegistry'
import { createSuccessResult } from './result'

export function getCapabilities() {
  return getRegisteredCapabilities()
}

export function buildCapabilitiesResult() {
  const capabilities = getCapabilities()
  return createSuccessResult('capabilities', {
    summary: {
      schemaVersion: capabilities.schemaVersion,
      commands: capabilities.commands.length,
      formats: capabilities.formats.length,
      chartTypes: capabilities.chartTypes.length,
      networkPolicy: capabilities.networkPolicy,
    },
    results: capabilities as unknown as Record<string, unknown>,
  })
}
