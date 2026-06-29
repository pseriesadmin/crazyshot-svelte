// src/lib/utils/toast.ts
// CrazyShot 표준 토스트 헬퍼
// 라이브러리: svelte-sonner (설치: npm install svelte-sonner)
// Toaster 컴포넌트는 src/routes/+layout.svelte에 1회 등록 필수
import { toast } from 'svelte-sonner'

// 공통 베이스: 545px × 60px, border-radius 30px, purple-dark 배경
const BASE =
  'width:545px; max-width:calc(100vw - 40px); height:60px; max-height:60px;' +
  'padding:15px 30px; display:flex; justify-content:space-between; align-items:center;' +
  'border-radius:30px; font-family:"Noto Sans KR",sans-serif; color:#ffffff; box-sizing:border-box;'

const BG_DEFAULT = 'background:#201857;'  // --cs-purple-dark

export const csToast = {
  success: (msg: string) =>
    toast.success(msg, {
      position: 'bottom-center',
      duration: 3000,
      style: `${BASE} ${BG_DEFAULT}`,
    }),

  info: (msg: string) =>
    toast(msg, {
      position: 'bottom-center',
      duration: 3000,
      style: `${BASE} ${BG_DEFAULT}`,
    }),

  warning: (msg: string) =>
    toast.warning(msg, {
      position: 'bottom-center',
      duration: 5000,
      style: `${BASE} ${BG_DEFAULT}`,
    }),

  error: (msg: string) =>
    toast.error(msg, {
      position: 'bottom-center',
      duration: 5000,
      style: `${BASE} ${BG_DEFAULT}`,
    }),
}
