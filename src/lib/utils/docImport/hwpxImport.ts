/**
 * hwpxImport.ts — 한글 문서(.hwp / .hwpx) → HTML 임포트
 *
 * 사용 패키지: hwp-convert@1.13.x (MIT, 순수 TypeScript, 브라우저·Node)
 *   - .hwpx : HwpxReader.loadFromArrayBuffer → extractHtml (표·병합·굵게/기울임/글자 크기·색 보존)
 *   - .hwp  : hwpToHwpx(HWP 5.0 이진 → HWPX) 후 같은 HwpxReader 경로
 *
 * 지원하지 않는 입력(암호화·배포용·HWP 3.0·형식 불일치)은 이유가 담긴 Error 를 던진다 — 호출부는 안내 화면에 그 메시지를 보여준다.
 * 변환 결과는 한글 화면과 같지 않다(차트·OLE·글맵시 미지원, 머리말·꼬리말·각주는 본문에 평탄 출력) — 경고 문구로 안내한다.
 */

import { applyHwpxFormatting } from './hwpxFormatting'

/** 한글 임포트 사용 여부 (false 설정 시 기본 안내 모달로만 처리됨) */
export const FEATURE_HWPX_EXPERIMENTAL = true

export interface HwpxImportResult {
  html: string
  warnings: string[]
}

const CONVERT_WARNING = '차트·OLE 개체·글맵시는 가져오지 못하고, 머리말·꼬리말·각주는 본문에 이어서 나옵니다. 가져온 뒤 확인해 주세요.'

/** hwp-convert 오류를 사용자에게 보일 한글 메시지로 바꾼다 (err.name 기반 — 패키지 클래스에 직접 의존하지 않음) */
function toUserError(err: unknown): Error {
  // constructor.name 은 프로덕션 번들(minify)에서 줄어들어 맞지 않는다 — hwp-convert 는 오류마다 this.name 을 직접 지정하므로 그것을 쓴다
  const name = err instanceof Error ? err.name : ''
  const msg = err instanceof Error ? err.message : ''
  if (name === 'HwpEncryptedError' || name === 'HwpxEncryptedDocumentError') {
    return new Error('암호가 걸린 문서는 가져올 수 없어요. 한글에서 암호를 해제한 뒤 다시 올려주세요.')
  }
  if (name === 'HwpUnsupportedError') {
    return new Error('배포용 문서 또는 구버전(HWP 3.0) 문서는 가져올 수 없어요. 한글에서 .docx로 저장해 올려주세요.')
  }
  if (name === 'HwpInvalidFormatError' || name === 'InvalidHwpxFormatError' || /zip|central directory|Corrupted/i.test(msg)) {
    return new Error('한글 문서 형식이 아니거나 파일이 손상되었어요. 파일을 확인해 주세요.')
  }
  return new Error('한글 문서를 변환하지 못했어요. 한글에서 .docx로 저장해 올려주세요.')
}

/** HWPX 바이트 → HTML (표 병합 보존, 이미지는 data URL 로 인라인) */
async function hwpxBytesToHtml(bytes: Uint8Array): Promise<string> {
  const { HwpxReader } = await import('hwp-convert')
  const reader = new HwpxReader()
  await reader.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const raw = await reader.extractHtml({ embedImages: true })
  // 문단 정렬·들여쓰기·글꼴·표 너비·셀 색을 HWPX 에서 직접 읽어 덧붙인다(실패해도 원본 HTML 유지)
  const html = raw ? await applyHwpxFormatting(raw, bytes) : raw
  if (!html || html.trim().length === 0) {
    throw new Error('변환 결과가 비어 있습니다. 파일 내용을 확인해주세요.')
  }
  return html
}

/** .hwpx 파일을 HTML 로 변환한다. @throws 사용자에게 보일 메시지를 가진 Error */
export async function importHwpx(file: File): Promise<HwpxImportResult> {
  try {
    const html = await hwpxBytesToHtml(new Uint8Array(await file.arrayBuffer()))
    return { html, warnings: [CONVERT_WARNING] }
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('변환 결과가') ? err : toUserError(err)
  }
}

/** .hwp(HWP 5.0 이진) 파일을 HTML 로 변환한다. @throws 사용자에게 보일 메시지를 가진 Error */
export async function importHwp(file: File): Promise<HwpxImportResult> {
  try {
    const { hwpToHwpx } = await import('hwp-convert')
    const hwpx = await hwpToHwpx(new Uint8Array(await file.arrayBuffer()))
    const html = await hwpxBytesToHtml(hwpx)
    return { html, warnings: [CONVERT_WARNING] }
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('변환 결과가') ? err : toUserError(err)
  }
}
