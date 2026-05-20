import type { RenderSourceLocator } from './sourceIdentity'
import type { RendererDefinition, RendererState, RendererTarget, RendererWarning } from './types'

export type RendererPolicyResult =
  | { ok: true }
  | { ok: false; state: RendererState; warning: RendererWarning }

export interface RendererPolicyContext {
  target: RendererTarget
  allowRemote?: boolean
}

function warningFor(
  renderer: RendererDefinition,
  locator: RenderSourceLocator,
  context: RendererPolicyContext,
  input: Pick<RendererWarning, 'code' | 'reason' | 'fallback'> & Partial<Pick<RendererWarning, 'userAction' | 'diagnostics'>>,
): RendererWarning {
  return {
    rendererType: renderer.type,
    blockId: locator.blockId,
    sourceKind: locator.sourceKind,
    sourceIndex: locator.sourceIndex,
    target: context.target,
    code: input.code,
    reason: input.reason,
    fallback: input.fallback,
    ...(locator.resolvedPath ? { filePath: locator.resolvedPath } : {}),
    ...(input.userAction ? { userAction: input.userAction } : {}),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  }
}

export function checkRendererPolicy(
  renderer: RendererDefinition,
  locator: RenderSourceLocator,
  context: RendererPolicyContext,
): RendererPolicyResult {
  const capability = renderer.capabilities[context.target]

  if (!capability || capability.state === 'unsupported') {
    return {
      ok: false,
      state: 'unsupported',
      warning: warningFor(renderer, locator, context, {
        code: 'RENDERER_TARGET_UNSUPPORTED',
        reason: `${renderer.displayName} does not support ${context.target}`,
        fallback: 'sourcePreserved',
      }),
    }
  }

  if (capability.state === 'optional' || capability.state === 'disabledByDefault') {
    return {
      ok: false,
      state: 'dependencyMissing',
      warning: warningFor(renderer, locator, context, {
        code: 'RENDERER_DEPENDENCY_MISSING',
        reason: capability.reason || `${renderer.displayName} requires optional setup`,
        fallback: 'sourcePreserved',
      }),
    }
  }

  if (renderer.networkPolicy === 'explicitRemoteAllowed' && context.allowRemote !== true) {
    return {
      ok: false,
      state: 'blockedBySecurityPolicy',
      warning: warningFor(renderer, locator, context, {
        code: 'RENDERER_REMOTE_BLOCKED',
        reason: `${renderer.displayName} requires remote rendering, but remote rendering is disabled`,
        fallback: 'blocked',
        userAction: 'Enable remote rendering only for trusted documents.',
      }),
    }
  }

  return { ok: true }
}
