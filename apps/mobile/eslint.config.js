// https://docs.expo.dev/guides/using-eslint/
const path = require('path');
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', '.expo-export-check/*', 'node_modules/*'],
  },
  {
    settings: {
      // In the monorepo the hoisted eslint-module-utils can't find the resolver by name,
      // so point at it explicitly and use this app's tsconfig paths (@/…).
      'import/resolver': {
        [require.resolve('eslint-import-resolver-typescript')]: {
          project: path.join(__dirname, 'tsconfig.json'),
        },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'] },
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]);
