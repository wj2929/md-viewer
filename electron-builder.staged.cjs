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
  electronLanguages: packageLocales.electronLanguages,
  directories: {
    ...packageJson.build.directories,
    app: '.package-app',
    output: 'dist/staged',
  },
  files: [
    'out/**/*',
    'package.json',
    'node_modules/**/*',
  ],
}
