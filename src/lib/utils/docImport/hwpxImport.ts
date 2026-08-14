/**
 * hwpxImport.ts — HWPX 실험적 임포트 모듈
 *
 * ⚠️ 실험적 기능 (FEATURE_HWPX_EXPERIMENTAL)
 *
 * 사용 패키지: hwp-convert@1.13.0 (MIT 라이선스)
 *   npm 배포 확인일: 2026-08-12
 *   브라우저 호환: ESM, 순수 TypeScript
 *   출처: https://www.npmjs.com/package/hwp-convert
 *
 * 지원 포맷:
 *   .hwpx → HTML 변환 → TipTap setContent
 *
 * 주의:
 *   - 복잡한 서식(표·이미지·특수문자)이 일부 손실될 수 있음
 *   - 변환 실패 시 Error throw → 호출부에서 catch 후 기본 안내 모달 폴백
 *   - .hwp (구 바이너리 OLE2 포맷)은 변환 품질이 매우 낮아 지원 제외
 */

/** HWPX 실험 파싱 feature-flag (false 설정 시 기본 안내 모달로만 처리됨) */
export const FEATURE_HWPX_EXPERIMENTAL = true

export interface HwpxImportResult {
  html: string
  warnings: string[]
}

/**
 * HWPX 파일을 HTML 문자열로 변환
 *
 * @throws 변환 실패 시 Error — 호출부에서 catch 후 기본 안내 모달로 폴백
 */
export async function importHwpx(file: File): Promise<HwpxImportResult> {
  // 동적 import로 번들 크기 최적화 (사용 시점에만 로드)
  const mod = await import('hwp-convert')

  const buf = await file.arrayBuffer()

  // hwp-convert v1.13.0 API — ESM named export 또는 default export 모두 지원
  const convertFn =
    (mod as Record<string, unknown>).convert ??
    (mod as Record<string, unknown>).default

  if (typeof convertFn !== 'function') {
    throw new Error('hwp-convert 모듈을 로드할 수 없습니다.')
  }

  // convert(buffer, format) → HTML 문자열 반환
  const rawResult = await (convertFn as (b: ArrayBuffer, f: string) => Promise<unknown>)(buf, 'html')

  // 반환값이 string이거나 { html: string } 형태 모두 수용
  let html: string
  if (typeof rawResult === 'string') {
    html = rawResult
  } else if (rawResult && typeof (rawResult as Record<string, unknown>).html === 'string') {
    html = (rawResult as Record<string, string>).html
  } else if (rawResult && typeof (rawResult as Record<string, unknown>).content === 'string') {
    html = (rawResult as Record<string, string>).content
  } else {
    throw new Error('hwp-convert 변환 결과 형식을 인식할 수 없습니다.')
  }

  if (!html || html.trim().length === 0) {
    throw new Error('변환 결과가 비어 있습니다. 파일 내용을 확인해주세요.')
  }

  return {
    html,
    warnings: [
      '실험 변환: 복잡한 서식(표·이미지·특수문자·다단 등)이 일부 손실될 수 있습니다.',
    ],
  }
}
