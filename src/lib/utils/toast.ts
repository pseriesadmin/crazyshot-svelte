// src/lib/utils/toast.ts
// CrazyShot 표준 토스트 헬퍼 — uiux.md §9 기준
// 라이브러리: svelte-sonner (설치: npm install svelte-sonner)
// Toaster 컴포넌트는 src/routes/+layout.svelte에 1회 등록 필수
import { toast } from 'svelte-sonner'

const BASE =
  'border-radius:30px; font-family:"Noto Sans KR",sans-serif; color:#ffffff;'

export const csToast = {
  success: (msg: string) =>
    toast.success(msg, {
      position: 'bottom-center',
      duration: 3000,
      style: `${BASE} background:var(--cs-dark,#100B32);`,
    }),

  info: (msg: string) =>
    toast(msg, {
      position: 'bottom-center',
      duration: 3000,
      style: `${BASE} background:var(--cs-purple-light,#553FE0);`,
    }),

  warning: (msg: string) =>
    toast.warning(msg, {
      position: 'bottom-center',
      duration: 5000,
      style: `${BASE} background:var(--cs-orange,#FF4500);`,
    }),

  error: (msg: string) =>
    toast.error(msg, {
      position: 'bottom-center',
      duration: 5000,
      style: `${BASE} background:var(--cs-red-badge,#FF3535);`,
    }),
}
