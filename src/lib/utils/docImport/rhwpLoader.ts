/**
 * rhwpLoader.ts — 한글 엔진(rhwp, Rust→WASM) 지연 로더 (브라우저 전용)
 *
 * 쓰는 곳: 계약서 양식 "파일 저장"(.hwp/.hwpx), 문서 가져오기의 "원본 미리보기"·누름틀 연결.
 * 엔진 파일(약 11.8MB, brotli 약 3.1MB)은 이 함수를 처음 부르는 순간에만 내려받는다 — 다른 화면·형식에는 영향이 없다.
 *
 * 규칙
 *  - npm 패키지 `@rhwp/core`는 package.json에서 정확한 버전으로 고정한다(^ 금지). 엔진 파일의 해시는
 *    `exportDepsCompat.test.ts`가 기록값과 비교해 바뀌면 실패시킨다(HOP와 같은 방식 — 변조·무심코 업데이트 방지).
 *  - 엔진은 문서를 서버로 보내지 않는다 — 모든 변환이 브라우저 안에서 일어난다.
 *  - 문서 핸들(HwpDocument)은 쓴 뒤 반드시 free()한다(WASM 메모리는 자동 회수되지 않는다).
 */
import type * as RhwpNamespace from '@rhwp/core'

export type RhwpModule = typeof RhwpNamespace

/** 엔진이 줄 폭 계산에 부르는 전역 훅 — 없으면 일부 경로가 실패한다. 브라우저 캔버스로 측정한다. */
export function installMeasureTextWidth(target: Record<string, unknown> = globalThis as Record<string, unknown>): void {
  if (typeof target['measureTextWidth'] === 'function') return
  let ctx: CanvasRenderingContext2D | null = null
  let lastFont = ''
  target['measureTextWidth'] = (font: string, text: string): number => {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return [...text].length * 8
    if (font !== lastFont) {
      ctx.font = font
      lastFont = font
    }
    return ctx.measureText(text).width
  }
}

let loading: Promise<RhwpModule> | null = null

/** 엔진을 한 번만 불러와 초기화한다. 실패하면 다음 호출에서 다시 시도한다. */
export function loadRhwp(): Promise<RhwpModule> {
  if (!loading) {
    loading = initRhwp().catch((err) => {
      loading = null
      throw err
    })
  }
  return loading
}

async function initRhwp(): Promise<RhwpModule> {
  const [mod, wasm] = await Promise.all([
    import('@rhwp/core'),
    import('@rhwp/core/rhwp_bg.wasm?url'),
  ])
  installMeasureTextWidth()
  await mod.default({ module_or_path: wasm.default })
  return mod
}
