const packageJson = require('./package.json')
const packageLocales = require('./config/package-locales.json')

const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH
const macConfig = packageArch === 'x64' || packageArch === 'arm64'
  ? {
      ...packageJson.build.mac,
      target: packageJson.build.mac.target.map(({ target }) => ({
        target,
        arch: [packageArch],
      })),
    }
  : packageJson.build.mac

module.exports = {
  ...packageJson.build,
  mac: macConfig,
  asar: true,
  npmRebuild: false,
  beforePack: async context => {
    const { capturePackageInputs } = await import('./scripts/capture-package-inputs.mjs')
    await capturePackageInputs(context)
  },
  electronLanguages: packageLocales.electronLanguages,
  directories: {
    ...packageJson.build.directories,
    app: '.package-app',
    output: 'dist/staged',
  },
  files: [
    'out/**/*',
    'package.json',
    'renderer-assets.json',
    'THIRD_PARTY_DISTRIBUTION_COMMENTS.txt',
    'node_modules/**/*',
    '!node_modules/**/*.d.ts.map',
    '!node_modules/axios/MIGRATION_GUIDE.md',
  ],
}
