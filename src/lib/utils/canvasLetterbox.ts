/**
 * canvasLetterbox.ts — 고정캔버스형(ContractCanvasEditor) A4 프레임 레터박스 보정 유틸
 *
 * .canvas-page는 항상 A4 비율(210:297)로 고정 표시되고, 배경 이미지는 그 안에
 * object-fit:contain(레터박스)으로 맞춰진다(C-3, 2026-08-14 Stephen 확정). 업로드된
 * 이미지 비율이 A4와 다르면 프레임 전체 ≠ 실제 이미지 렌더 영역이 되므로, 필드 좌표
 * (이미지 픽셀 좌표계, 기존 저장값 그대로 유효)를 "프레임 기준 %"가 아니라 "레터박스된
 * 이미지의 실제 렌더 사각형 기준"으로 다시 계산해야 한다.
 *
 * 순수 함수로 분리 — ContractCanvasEditor.svelte(렌더링·클릭/드래그 좌표 역산)와
 * 단위 테스트(canvasLetterbox.test.ts) 양쪽에서 재사용한다.
 */

/** A4 비율 (width/height) */
export const A4_RATIO = 210 / 297

export interface ContentBox {
  /** 프레임 폭 대비 이미지 좌측 여백 비율(0~1) */
  offsetXFrac: number
  /** 프레임 높이 대비 이미지 상단 여백 비율(0~1) */
  offsetYFrac: number
  /** 프레임 폭 대비 이미지 렌더 폭 비율(0~1) */
  widthFrac: number
  /** 프레임 높이 대비 이미지 렌더 높이 비율(0~1) */
  heightFrac: number
}

export interface ContentRectPx {
  left: number
  top: number
  width: number
  height: number
  /** 이미지 픽셀 → 화면 픽셀 배율 (widthFrac/heightFrac 중 1인 쪽 기준 — 항상 등가) */
  scale: number
}

/**
 * object-fit:contain 레터박스 결과를 프레임 대비 비율(0~1)로 계산한다.
 *
 * @param imageWidth  업로드된 이미지의 원본 너비(px)
 * @param imageHeight 업로드된 이미지의 원본 높이(px)
 */
export function getContentBox(imageWidth: number, imageHeight: number): ContentBox {
  const imgRatio = imageWidth / imageHeight
  const r = imgRatio / A4_RATIO
  if (r >= 1) {
    // 이미지가 프레임보다 넓적함 — 폭 100% 채움, 위아래 레터박스
    const heightFrac = 1 / r
    return { offsetXFrac: 0, offsetYFrac: (1 - heightFrac) / 2, widthFrac: 1, heightFrac }
  }
  // 이미지가 프레임보다 홀쭉함 — 높이 100% 채움, 좌우 레터박스
  const widthFrac = r
  return { offsetXFrac: (1 - widthFrac) / 2, offsetYFrac: 0, widthFrac, heightFrac: 1 }
}

/**
 * 필드(이미지 픽셀 좌표계)를 프레임 기준 % 스타일 문자열로 변환(레터박스 보정 포함).
 */
export function fieldStyle(
  field: { x: number; y: number; width: number; height: number },
  page: { width: number; height: number },
): string {
  const box = getContentBox(page.width, page.height)
  const leftPct   = (box.offsetXFrac + (field.x / page.width)  * box.widthFrac)  * 100
  const topPct    = (box.offsetYFrac + (field.y / page.height) * box.heightFrac) * 100
  const widthPct  = (field.width  / page.width)  * box.widthFrac  * 100
  const heightPct = (field.height / page.height) * box.heightFrac * 100
  return `left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;`
}

/**
 * 프레임의 화면 픽셀 사각형(frameRect) 안에서 실제 이미지가 렌더링되는 영역(px)과 배율을 계산한다.
 * onPageClick/onFieldPointerMove의 좌표 역산(스크린 px → 이미지 px)에 사용.
 */
export function getContentRectPx(
  page: { width: number; height: number },
  frameRect: { left: number; top: number; width: number; height: number },
): ContentRectPx {
  const box = getContentBox(page.width, page.height)
  const left   = frameRect.left + box.offsetXFrac * frameRect.width
  const top    = frameRect.top  + box.offsetYFrac * frameRect.height
  const width  = box.widthFrac  * frameRect.width
  const height = box.heightFrac * frameRect.height
  // widthFrac/heightFrac은 항상 하나가 1이므로 폭 기준 스케일이 높이 기준과 항상 일치함
  const scale = width / page.width
  return { left, top, width, height, scale }
}
