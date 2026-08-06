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

// 푸시알림 연동(S4)용 선택적 옵션 — 기존 4메서드 호출부(csToast.info(msg) 등)는
// 두 번째 인자를 넘기지 않으므로 시그니처 하위호환 100% 유지
export interface CsToastOptions {
  /** 지정 시 토스트에 액션 버튼이 표시되고 클릭하면 호출됨 (예: 알림 상세로 이동) */
  onClick?: () => void
  /** 액션 버튼 레이블 (기본: '보기') */
  actionLabel?: string
}

function buildOptions(duration: number, options?: CsToastOptions) {
  const base = {
    position: 'bottom-center' as const,
    duration,
    style: `${BASE} ${BG_DEFAULT}`,
  }
  if (!options?.onClick) return base
  return {
    ...base,
    action: {
      label: options.actionLabel ?? '보기',
      onClick: options.onClick,
    },
  }
}

export const csToast = {
  success: (msg: string, options?: CsToastOptions) =>
    toast.success(msg, buildOptions(3000, options)),

  info: (msg: string, options?: CsToastOptions) =>
    toast(msg, buildOptions(3000, options)),

  warning: (msg: string, options?: CsToastOptions) =>
    toast.warning(msg, buildOptions(5000, options)),

  error: (msg: string, options?: CsToastOptions) =>
    toast.error(msg, buildOptions(5000, options)),
}
