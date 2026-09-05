const packageJson = require('./package.json')
const packageLocales = require('./config/package-locales.json')

module.exports = {
  ...packageJson.build,
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
