const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Number: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        String: 'readonly',
        parseFloat: 'readonly',
        parseInt: 'readonly',
        isNaN: 'readonly',
        Promise: 'readonly',
        Error: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
      'no-extra-semi': 'error',
      'no-unreachable': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
      semi: ['error', 'always'],
      'no-mixed-spaces-and-tabs': 'error',
    },
    ignores: [
      'node_modules/',
      'coverage/',
      '*.min.js',
      'public/js/',
      'smart-control/node_modules/',
      'simulator/node_modules/',
    ]
  }
];
