// eslint.config.js — 크레이지샷 하네스 강제 규칙 (ESLint v10+)
// harness H-01~H-06 적용
//
// 정책 계층 (AGENTS.md · boundary-rules.yaml 정합):
//   Tier A — TDD 절대 금지 (ESLint no-restricted-syntax)
//     H-01: rental_reservations 직접 INSERT → atomic_reserve_asset RPC
//     H-02: 클라이언트 가격 계산 (price * 할인율) → calculate_cart_total RPC
//   Tier B — CMS 관리자 CRUD (서버 + service role)
//     cms_* RPC 권장 (accounts·codes 이미 적용) — ESLint 강제 아님, pre-commit 통과
//     신규 CMS 모듈은 cms_* RPC 패턴 우선
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
  // Tier A: TDD 도메인 절대 금지 (boundary-rules.yaml h_01 / h_02 와 동일)
  'no-restricted-syntax': [
    'error',
    // H-01: rental_reservations 직접 INSERT (이중예약 위험)
    {
      selector:
        "CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from'][callee.object.arguments.0.type='Literal'][callee.object.arguments.0.value='rental_reservations']",
      message: '[H-01] rental_reservations 직접 INSERT 금지. atomic_reserve_asset RPC 사용. (AGENTS.md)',
    },
    // H-02: 클라이언트 가격 계산 (boundary-rules.yaml h_02_client_price_calc)
    {
      selector:
        "VariableDeclarator[init.type='BinaryExpression'][init.operator='*'] > Identifier[name=/price/i]",
      message: '[H-02] 클라이언트 가격 계산 금지. calculate_cart_total RPC 사용. (AGENTS.md)',
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
    ignores: [
      'node_modules/',
      '.svelte-kit/',
      'build/',
      'dist/',
      '*.config.js',
      // S1-M? 채팅 모듈 — RPC 마이그레이션 완료 후 별도 커밋 시 ignore 제거
      'src/lib/components/chat/**',
      'src/routes/api/chat/**',
      'src/routes/chat/**',
      'src/lib/services/chatService.ts',
      'src/lib/services/supabaseBrowser.ts',
      'src/lib/stores/chat.svelte.ts',
      'src/lib/types/chat.ts',
    ],
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
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        history: 'readonly',
        sessionStorage: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URLSearchParams: 'readonly',
        Event: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLElement: 'readonly',
      },
    },
    plugins: {
      svelte: sveltePlugin,
    },
    rules: commonRules,
  },

  // Tier B: CMS 관리자 UI — 카테고리 맵·폼 배열 인덱스는 서버 검증 전 UI 상태 전용
  {
    files: ['src/routes/cms/**/*.{ts,svelte}'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
];
