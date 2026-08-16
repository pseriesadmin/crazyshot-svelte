/**
 * pdfRasterize.ts — PDF 클라이언트 래스터화 유틸리티 (Phase 6, P6-2)
 *
 * ⛔ 클라이언트(브라우저) 전용 — 서버에서 절대 호출 금지.
 *    Vercel 서버(Edge/Node)에 PDF 렌더링 인프라를 두지 않는다는 설계 원칙 준수.
 *    canvas 모드 배경 PDF 처리는 반드시 이 파일을 통해 클라이언트에서 처리한다.
 *
 * 동작:
 *   1. PDF File 수신 → ArrayBuffer 변환
 *   2. pdfjs-dist로 각 페이지를 Canvas 엘리먼트에 렌더링
 *   3. Canvas → Blob(PNG) 변환
 *   4. 배열로 반환 (각 페이지 = { blob, width, height, pageNum })
 *
 * EC-1: numPages === 0 → 빈 PDF 거부 (에러 throw)
 */

import { browser } from '$app/environment'
// Vite 전용 명시적 애셋 URL 임포트 — pdfjs 공식 권장 `new URL(literal, import.meta.url)`
// 패턴 대신 사용(더 견고함). 이 프로젝트의 vite@^8 처럼 매우 최신 메이저 버전에서는
// 번들러의 정적 애셋 추론 휴리스틱이 예상과 다르게 동작할 위험이 있는데, `?url` 접미사
// 임포트는 Vite 1급 기능이라 버전에 안전하다(C-2, 2026-08-14).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface RasterizedPage {
  blob: Blob
  width: number
  height: number
  pageNum: number
}

/**
 * PDF 파일을 페이지별 PNG 이미지 Blob 배열로 래스터화합니다.
 *
 * @param file     PDF File 객체
 * @param scale    렌더링 배율 (기본 1.5 — 72dpi → 108dpi, 문서 가독성 확보)
 * @returns        페이지 순서대로 정렬된 RasterizedPage 배열
 * @throws Error   브라우저 환경이 아닐 때 | 빈 PDF(numPages=0) | 캔버스 컨텍스트 실패
 */
export async function rasterizePdf(
  file: File,
  scale = 1.5,
): Promise<RasterizedPage[]> {
  if (!browser) {
    throw new Error('rasterizePdf는 브라우저 전용입니다. 서버에서 호출 금지.')
  }

  // 동적 import — 서버 번들에 포함되지 않도록 (클라이언트 전용 보장)
  const pdfjsLib = await import('pdfjs-dist')

  // Worker 소스 설정 — 파일 상단의 `?url` 정적 임포트(pdfWorkerUrl) 사용.
  // GlobalWorkerOptions.workerSrc가 아직 설정되지 않은 경우에만 초기화
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  }

  const arrayBuffer = await file.arrayBuffer()

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch {
    throw new Error('PDF 파일을 읽을 수 없습니다. 유효한 PDF인지 확인해 주세요.')
  }

  // EC-1: 빈 PDF 거부
  if (pdf.numPages === 0) {
    throw new Error('빈 PDF입니다. 내용이 있는 PDF 파일을 업로드해 주세요.')
  }

  const pages: RasterizedPage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width  = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error(`페이지 ${i} 렌더링 실패 — Canvas 2D 컨텍스트를 생성할 수 없습니다.`)
    }

    await page.render({ canvasContext: ctx, viewport }).promise

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`페이지 ${i} PNG 변환에 실패했습니다.`))),
        'image/png',
      ),
    )

    pages.push({ blob, width: canvas.width, height: canvas.height, pageNum: i })
  }

  return pages
}
