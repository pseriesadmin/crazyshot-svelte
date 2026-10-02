// Svelte 컴포넌트를 jsdom에서 실제로 mount하는 테스트 전용 설정 — 기본 vite.config.ts는 서버 빌드로 해석되어 mount()가 불가하다.
// 실행: npx vitest run --config vitest.component.config.ts
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'

export default defineConfig({
  plugins: [sveltekit()],
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'jsdom',
    env: { CS_COMPONENT_TEST: '1' },
    include: ['src/__tests__/components/**/*.mount.test.ts'],
  },
})
