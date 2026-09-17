import { describe, it, expect, vi } from 'vitest'
import { renderQrToCanvas, QR_CANVAS_SIZE } from '../../lib/utils/qrIssue'

/**
 * qrIssue.ts — renderQrToCanvas 회귀 테스트
 * (2026-09-17, BLOCKING #1 수정 후 추가 — "버퍼 항상 300px" 규칙 자동 검증)
 *
 * 이 테스트가 존재하는 이유:
 *   QRCode.toCanvas()는 렌더링 후 canvas.style.width/height를 인라인으로 강제 설정해
 *   외부 CSS 표시 크기를 덮어쓴다. 이전에 호출부에서 작은 width(88/44/220)를 그대로
 *   QRCode.toCanvas에 전달해 버퍼도 작아지는 결함이 있었다(BLOCKING #1, sp3 1차 반려).
 *   renderQrToCanvas 내부에서 항상 QR_CANVAS_SIZE(300)을 사용하고 인라인 스타일을
 *   초기화해야 한다는 규칙을 이 테스트가 자동으로 지킨다.
 */

// qrcode 라이브러리 mock —
//   QRCode.toCanvas가 canvas.width/height를 요청한 width로 설정하고
//   canvas.style.width/height를 인라인으로 덮어쓰는 실제 동작을 재현.
vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn(
      async (
        canvas: HTMLCanvasElement,
        _payload: string,
        opts: { width: number },
      ) => {
        canvas.width = opts.width
        canvas.height = opts.width
        // qrcode 라이브러리가 실제로 설정하는 인라인 스타일 재현
        canvas.style.width = `${opts.width}px`
        canvas.style.height = `${opts.width}px`
      },
    ),
  },
}))

/** 최소 canvas mock 팩토리 (Node 환경 — HTMLCanvasElement 없음) */
function makeCanvas(displayPx: number): HTMLCanvasElement {
  return {
    width: displayPx,
    height: displayPx,
    style: { width: `${displayPx}px`, height: `${displayPx}px` },
  } as unknown as HTMLCanvasElement
}

describe('renderQrToCanvas — 버퍼 크기 & 인라인 스타일 초기화', () => {
  it('표시 크기 88px 캔버스로 호출해도 버퍼는 QR_CANVAS_SIZE(300)으로 렌더링된다', async () => {
    const canvas = makeCanvas(88)
    await renderQrToCanvas(canvas, 'CSLENall00001|LENS')
    expect(canvas.width).toBe(QR_CANVAS_SIZE)
    expect(canvas.height).toBe(QR_CANVAS_SIZE)
  })

  it('표시 크기 44px 캔버스로 호출해도 버퍼는 300×300이다', async () => {
    const canvas = makeCanvas(44)
    await renderQrToCanvas(canvas, 'CS2609001')
    expect(canvas.width).toBe(QR_CANVAS_SIZE)
  })

  it('렌더링 후 canvas.style.width/height가 빈 문자열로 초기화된다 (CSS 표시 크기 지배)', async () => {
    const canvas = makeCanvas(88)
    await renderQrToCanvas(canvas, 'CSLENall00001')
    expect(canvas.style.width).toBe('')
    expect(canvas.style.height).toBe('')
  })

  it('width 옵션 없이도 QR_CANVAS_SIZE를 기본값으로 쓴다', async () => {
    const canvas = makeCanvas(220)
    await renderQrToCanvas(canvas, '/qr/member/MEM-0001')
    expect(canvas.width).toBe(QR_CANVAS_SIZE)
  })
})
