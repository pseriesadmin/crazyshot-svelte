import { describe, it, expect } from 'vitest'
import {
  ZOOM_STEPS,
  CSS_PX_PER_PT,
  stepZoom,
  clampZoom,
  fitWidthZoom,
  toDisplayPercent,
  pdfScale,
  currentPageFromScroll,
  normalizeRotation,
  clampPage,
  thumbnailScale,
  isIosDevice,
} from '$lib/utils/pdfViewerLogic'

describe('pdfViewerLogic — 줌', () => {
  it('확대·축소는 정의된 단계(50%~300%)를 한 칸씩 이동하고 양 끝에서 멈춘다', () => {
    expect(ZOOM_STEPS[0]).toBe(0.5)
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(3)
    expect(stepZoom(1, 'in')).toBe(1.25)
    expect(stepZoom(1, 'out')).toBe(0.75)
    expect(stepZoom(3, 'in')).toBe(3)
    expect(stepZoom(0.5, 'out')).toBe(0.5)
  })

  it('단계 사이의 값(맞춤 배율 등)에서는 가장 가까운 다음/이전 단계로 이동한다', () => {
    expect(stepZoom(1.1, 'in')).toBe(1.25)
    expect(stepZoom(1.1, 'out')).toBe(1)
    expect(stepZoom(0.3, 'in')).toBe(0.5)
    expect(stepZoom(5, 'out')).toBe(3)
  })

  it('배율은 허용 범위(50%~300%)로 고정한다', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(9)).toBe(3)
    expect(clampZoom(1.3)).toBe(1.3)
  })

  it('가로 맞춤 = (영역 너비 - 좌우 여백) / (페이지 폭 pt × 1.333), 허용 범위로 고정', () => {
    // 영역 700px, 여백 양쪽 20px씩, 페이지 폭 595pt(A4) → 약 83%
    expect(fitWidthZoom(700, 595, 20)).toBeCloseTo(660 / (595 * CSS_PX_PER_PT), 5)
    expect(fitWidthZoom(50, 595, 20)).toBe(0.5)
    expect(fitWidthZoom(5000, 100, 20)).toBe(3)
    expect(fitWidthZoom(0, 595, 20)).toBe(1) // 아직 측정 전이면 100%
    expect(fitWidthZoom(700, 0, 20)).toBe(1)
  })

  it('표시 퍼센트는 브라우저 PDF 뷰어처럼 96dpi 기준 100% = 1pt가 1.333px', () => {
    expect(CSS_PX_PER_PT).toBeCloseTo(96 / 72, 5)
    expect(toDisplayPercent(1)).toBe(100)
    expect(toDisplayPercent(0.832)).toBe(83)
    expect(pdfScale(1)).toBeCloseTo(CSS_PX_PER_PT, 5) // pdf.js 렌더 배율 = 줌 × 1.333
    expect(pdfScale(0.75)).toBeCloseTo(1, 5)
  })
})

describe('pdfViewerLogic — 현재 쪽 판정', () => {
  // 쪽 위치(스크롤 컨텐츠 기준 top, height)
  const pages = [
    { top: 20, height: 800 },
    { top: 840, height: 800 },
    { top: 1660, height: 800 },
  ]

  it('뷰포트 중앙선이 걸친 쪽을 현재 쪽으로 본다', () => {
    expect(currentPageFromScroll(pages, 0, 600)).toBe(1) // 중앙 300 → 1쪽
    expect(currentPageFromScroll(pages, 700, 600)).toBe(2) // 중앙 1000 → 2쪽
    expect(currentPageFromScroll(pages, 1500, 600)).toBe(3) // 중앙 1800 → 3쪽
  })

  it('쪽 사이 간격에 중앙선이 걸리면 아래쪽(다음 쪽 시작 전이면 위쪽) 가까운 쪽', () => {
    expect(currentPageFromScroll(pages, 530, 600)).toBe(1) // 중앙 830: 1쪽 끝(820)과 2쪽 시작(840) 사이 → 가까운 1쪽
    expect(currentPageFromScroll(pages, 550, 600)).toBe(2) // 중앙 850 → 2쪽
  })

  it('끝까지 스크롤하면 마지막 쪽, 쪽이 없으면 1', () => {
    expect(currentPageFromScroll(pages, 5000, 600)).toBe(3)
    expect(currentPageFromScroll([], 0, 600)).toBe(1)
  })
})

describe('pdfViewerLogic — 기타', () => {
  it('회전은 0·90·180·270으로 정규화한다(음수 포함)', () => {
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(-90)).toBe(270)
  })

  it('쪽 번호 입력은 1~전체 쪽 사이로 고정하고 숫자가 아니면 null', () => {
    expect(clampPage('2', 5)).toBe(2)
    expect(clampPage('0', 5)).toBe(1)
    expect(clampPage('99', 5)).toBe(5)
    expect(clampPage('abc', 5)).toBeNull()
    expect(clampPage('', 5)).toBeNull()
    expect(clampPage('2.7', 5)).toBe(2)
  })

  it('썸네일 배율은 목표 너비(CSS px)에 페이지 폭을 맞춘다', () => {
    expect(thumbnailScale(595, 110)).toBeCloseTo(110 / 595, 5)
    expect(thumbnailScale(0, 110)).toBe(0.2)
  })

  it('iOS 기기(아이폰·아이패드, 데스크톱 모드 아이패드 포함)를 구분한다', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true) // 아이패드 데스크톱 모드(터치 지점 있음)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(isIosDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 0)).toBe(false)
  })
})
