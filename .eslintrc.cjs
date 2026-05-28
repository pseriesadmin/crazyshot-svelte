// .eslintrc.cjs — 크레이지샷 하네스 강제 규칙
// harness H-01~H-06 적용
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'security'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  overrides: [{ files: ['*.svelte'], processor: 'svelte/svelte' }],
  rules: {
    // H-01: 직접 INSERT 차단 (이중예약 위험)
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from']",
        message: '[H-01] supabase.from().insert() 금지. atomic_reserve_asset RPC 사용. (AGENTS.md 절대 금지)'
      },
      {
        selector: "CallExpression[callee.property.name='update'][callee.object.type='CallExpression'][callee.object.callee.property.name='from']",
        message: '[H-02] supabase.from().update() 금지. 전용 RPC 사용. (AGENTS.md 절대 금지)'
      }
    ],
    // H-03: any 타입 금지
    '@typescript-eslint/no-explicit-any': 'error',
    // H-04: console.log 금지 (프로덕션)
    'no-console': process.env.NODE_ENV === 'production'
      ? ['error', { allow: ['warn', 'error'] }]
      : ['warn'],
    // H-05: 미사용 변수 금지
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // H-06: 보안 취약점 정적 분석
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-object-injection': 'warn'
  },
  ignorePatterns: ['node_modules/', '.svelte-kit/', 'build/', 'dist/']
}
