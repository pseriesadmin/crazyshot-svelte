// eslint.config.js — 크레이지샷 하네스 강제 규칙 (ESLint v10+)
// harness H-01~H-06 적용
import js from '@eslint/js';
import ts from 'typescript-eslint';
import security from 'eslint-plugin-security';
import svelteParser from 'svelte-eslint-parser';
import sveltePlugin from 'eslint-plugin-svelte';

const commonRules = {
  // H-03: any 타입 금지
  '@typescript-eslint/no-explicit-any': 'error',
  // H-05: 미사용 변수 금지
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  // H-01: 직접 INSERT 차단 (이중예약 위험)
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from']",
      message: '[H-01] supabase.from().insert() 금지. atomic_reserve_asset RPC 사용. (AGENTS.md 절대 금지)',
    },
    {
      selector:
        "CallExpression[callee.property.name='update'][callee.object.type='CallExpression'][callee.object.callee.property.name='from']",
      message: '[H-02] supabase.from().update() 금지. 전용 RPC 사용. (AGENTS.md 절대 금지)',
    },
  ],
  // H-04: console.log 금지 (프로덕션), warn/error는 허용
  'no-console': process.env.NODE_ENV === 'production' ? ['error', { allow: ['warn', 'error'] }] : ['off', { allow: ['warn', 'error'] }],
  // H-06: 보안 취약점 정적 분석
  'security/detect-eval-with-expression': 'error',
  'security/detect-non-literal-regexp': 'warn',
  'security/detect-object-injection': 'warn',
};

export default [
  // Global ignores
  {
    ignores: ['node_modules/', '.svelte-kit/', 'build/', 'dist/', '*.config.js'],
  },

  // JavaScript/TypeScript rules
  js.configs.recommended,
  ...ts.configs.recommended,
  security.configs.recommended,

  // TypeScript-specific rules
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: commonRules,
  },

  // Svelte-specific rules
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
      },
      globals: {
        console: 'readonly',
      },
    },
    plugins: {
      svelte: sveltePlugin,
    },
    rules: commonRules,
  },
];
