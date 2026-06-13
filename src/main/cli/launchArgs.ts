const ignoredRuntimePattern = /(?:electron|node|index\.js)$/i

export function extractGuiLaunchPath(args: string[]): string | null {
  if (args[0] === 'open') {
    return extractOpenCommandPath(args.slice(1))
  }

  const userArgs = args.filter(arg =>
    !arg.startsWith('--') &&
    !arg.startsWith('-') &&
    arg !== '.' &&
    !ignoredRuntimePattern.test(arg),
  )

  return userArgs.length > 0 ? userArgs[userArgs.length - 1] : null
}

function extractOpenCommandPath(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('--')) {
      const hasInlineValue = arg.includes('=')
      if (!hasInlineValue && args[index + 1] && !args[index + 1].startsWith('--')) {
        index += 1
      }
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    return arg
  }

  return null
}
