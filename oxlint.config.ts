import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';

export default defineConfig({
  categories: {
    pedantic: 'off',
    restriction: 'off',
    style: 'off',
  },
  extends: [core],
  ignorePatterns: [...core.ignorePatterns, 'test/**', 'fixtures/**'],
  rules: {
    'class-methods-use-this': 'off',
    complexity: 'off',
    'func-style': 'off',
    'import-style': 'off',
    'no-await-in-loop': 'off',
    'no-nested-ternary': 'off',
    'no-redeclare': 'off',
    'no-use-before-define': 'off',
    'parameter-properties': 'off',
    'prefer-await-to-callbacks': 'off',
    'prefer-await-to-then': 'off',
    'prefer-destructuring': 'off',
    'prefer-named-capture-group': 'off',
    'require-await': 'off',
    'require-unicode-regexp': 'off',
    'unicorn/no-array-sort': 'off',
    'unicorn/no-lonely-if': 'off',
    'unicorn/no-nested-ternary': 'off',
  },
});
