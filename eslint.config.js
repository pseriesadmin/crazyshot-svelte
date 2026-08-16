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
import globals from 'globals';

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
  // 2026-08-17: no-undef은 타입 전용 전역(예: ImageBitmapSource 등 lib.dom.d.ts 타입 별칭)까지
  // "정의되지 않음"으로 오탐하고, 실제 미정의 참조는 이미 TypeScript 컴파일러(tsc/svelte-check)가
  // 잡아낸다 — typescript-eslint 공식 권장대로 비활성화.
  'no-undef': 'off',
};

export default [
  // Global ignores
  {
    ignores: [
      'node_modules/',
      '.svelte-kit/',
      '.vercel/',
      'build/',
      'dist/',
      '*.config.js',
      // 2026-08-17: 저장소 안에 남는 git worktree(.claude/worktrees/**)·로컬 Vercel 빌드 산출물
      // (.vercel/output, 번들된 서버 청크)·벤더 번들이 `npm run lint`(eslint .) 실행 시 함께
      // 스캔돼 수만 건의 가짜 문제를 만들어냄
      '.claude/worktrees/**',
      '**/*.min.js',
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
      // 2026-08-17: 수동으로 나열하던 DOM 전역 목록(FocusEvent/HTMLImageElement/ClipboardEvent/
      // AbortController 등 누락)을 globals 패키지의 표준 browser 세트로 교체 — no-undef 오탐 66건 해소
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      svelte: sveltePlugin,
    },
    rules: commonRules,
  },

  // Tier B: 모든 Svelte UI 파일 — 배열 인덱스는 클라이언트 내부 상태 전용
  // detect-object-injection은 서버사이드(+server.ts, src/lib/services/)에서만 유의미.
  // .svelte 파일의 $state/$derived 인덱스 접근은 실제 injection 위험 없음.
  {
    files: ['**/*.svelte'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
];
