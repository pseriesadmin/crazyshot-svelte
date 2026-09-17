/**
 * qrIssue.ts — QR 코드 발행 중앙 모듈
 *
 * 크레이지샷 QR 발행 로직을 6곳에서 복붙하던 방식을 단일 모듈로 통합.
 * - buildProductQrPayload: 상품 QR에 카테고리 병기 (신버전 payload)
 * - renderQrToCanvas: DOM 의존, 브라우저 전용
 * - buildQrDataUrl: 서버·일괄인쇄 겸용 순수함수
 * - downloadQrWithLabel: DOM 의존, 브라우저 전용 — 기존 3곳 복붙 라벨합성 로직 그대로 추출
 * - PNG_DPI / injectPngPhysicalDpi: 300 DPI pHYs 청크 삽입
 *
 * ⚠️ 파일 내 함수 구분:
 *   [순수함수/서버겸용] buildProductQrPayload, buildQrDataUrl, injectPngPhysicalDpi
 *   [DOM 의존/브라우저 전용] renderQrToCanvas, downloadQrWithLabel
 *   send-chat/+server.ts는 순수함수만 import할 것.
 */

/** 캔버스 버퍼 해상도 (픽셀) — 화면 표시 크기와 독립적 */
export const QR_CANVAS_SIZE = 300

/** PNG 다운로드/생성 시 삽입할 DPI (pHYs 청크) */
export const PNG_DPI = 300

// ──────────────────────────────────────────────────────────────────────────────
// 순수 함수 (서버·브라우저 양쪽 호환)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 상품 QR payload 생성 — 신버전: `{product_code}|{category}`
 * products.md §2-4: 상품 QR만 카테고리 병기, 다른 5곳(예약/회원 등) payload는 무변경.
 * 파싱 쪽(qrProductId.ts extractProductId)에서 `|` 앞부분만 추출해 하위호환 유지.
 */
export function buildProductQrPayload(productCode: string, category: string): string {
  return `${productCode}|${category}`
}

/**
 * QR 데이터 URL 생성 — 서버·일괄인쇄용 순수함수.
 * 반환값은 Base64 PNG data URL로, PNG 버퍼에 pHYs 300 DPI 메타데이터가 삽입됨.
 */
export async function buildQrDataUrl(
  payload: string,
  opts?: { width?: number; margin?: number },
): Promise<string> {
  const QRCode = (await import('qrcode')).default
  const width = opts?.width ?? QR_CANVAS_SIZE
  const margin = opts?.margin ?? 1
  const dataUrl: string = await QRCode.toDataURL(payload, {
    width,
    margin,
    color: { dark: '#100B32', light: '#FFFFFF' },
  })
  // data URL → Uint8Array → DPI 주입 → data URL
  const base64 = dataUrl.split(',')[1]
  if (!base64) return dataUrl
  const binary = typeof atob !== 'undefined'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const withDpi = injectPngPhysicalDpi(bytes, PNG_DPI)
  // Uint8Array → base64
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < withDpi.length; i += chunk) {
    b64 += String.fromCharCode(...withDpi.subarray(i, i + chunk))
  }
  const encodedB64 = typeof btoa !== 'undefined'
    ? btoa(b64)
    : Buffer.from(b64, 'binary').toString('base64')
  return `data:image/png;base64,${encodedB64}`
}

/**
 * PNG 바이트 스트림에 pHYs 청크를 삽입해 DPI 메타데이터를 기록한다.
 * 외부 라이브러리 의존 없음 — CRC32 자체 구현, Uint8Array/DataView만 사용.
 *
 * pHYs 청크 위치: PNG 시그니처(8) + IHDR(25) 직후
 * pHYs 구조: length(4) + type(4 = "pHYs") + pixX(4) + pixY(4) + unit(1) + CRC(4) = 21바이트
 *
 * @param pngBytes  원본 PNG Uint8Array (변경하지 않음)
 * @param dpi       목표 DPI (기본 PNG_DPI=300)
 * @returns         pHYs 삽입된 새 Uint8Array
 */
export function injectPngPhysicalDpi(pngBytes: Uint8Array, dpi: number = PNG_DPI): Uint8Array {
  // pHYs: 미터당 픽셀 수 = round(dpi / 0.0254)
  const ppm = Math.round(dpi / 0.0254) // 300 DPI → 11811 (0x00002E23)

  // pHYs 청크 데이터 (9바이트: pixelsPerUnitX 4 + pixelsPerUnitY 4 + unit 1)
  const physData = new Uint8Array(9)
  const physView = new DataView(physData.buffer)
  physView.setUint32(0, ppm, false) // pixelsPerUnitX (big-endian)
  physView.setUint32(4, ppm, false) // pixelsPerUnitY (big-endian)
  physView.setUint8(8, 1)           // unit = 1 (meter)

  // CRC32 계산 대상: type(4) + data(9) = 13바이트
  const typeBytes = new Uint8Array([0x70, 0x48, 0x59, 0x73]) // "pHYs"
  const crcInput = new Uint8Array(13)
  crcInput.set(typeBytes, 0)
  crcInput.set(physData, 4)
  const crc = crc32(crcInput)

  // pHYs 청크 조립: length(4) + type(4) + data(9) + crc(4) = 21바이트
  const physChunk = new Uint8Array(21)
  const chunkView = new DataView(physChunk.buffer)
  chunkView.setUint32(0, 9, false) // length = 9 (data 크기만, type/crc 제외)
  physChunk.set(typeBytes, 4)
  physChunk.set(physData, 8)
  chunkView.setUint32(17, crc, false) // CRC (big-endian)

  // 삽입 위치: 시그니처(8) + IHDR(25) = 오프셋 33 직후
  const insertAt = 33
  const result = new Uint8Array(pngBytes.length + 21)
  result.set(pngBytes.subarray(0, insertAt), 0)
  result.set(physChunk, insertAt)
  result.set(pngBytes.subarray(insertAt), insertAt + 21)
  return result
}

/**
 * CRC32 계산 — PNG 표준 다항식(0xEDB88320 reflected)
 * 외부 라이브러리 없이 순수 구현.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ──────────────────────────────────────────────────────────────────────────────
// DOM 의존 함수 (브라우저 전용)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * QR 코드를 canvas에 렌더링 — QRCode.toCanvas 래핑.
 *
 * 버퍼 해상도: 항상 QR_CANVAS_SIZE(300)×300으로 고정.
 * QRCode.toCanvas()는 렌더링 후 canvas.style.width/height를 인라인으로 강제 설정해
 * 외부 CSS 표시 크기를 덮어쓴다 — 렌더링 직후 인라인 스타일을 빈 문자열로 초기화해
 * 각 컴포넌트의 CSS 규칙이 화면 표시 크기를 지배하도록 한다.
 * (화면 표시: CSS 제어 / 다운로드 PNG: 300×300 고해상도)
 */
export async function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  payload: string,
  opts?: { margin?: number },
): Promise<void> {
  try {
    const QRCode = (await import('qrcode')).default
    await QRCode.toCanvas(canvas, payload, {
      width: QR_CANVAS_SIZE,
      margin: opts?.margin ?? 1,
      color: { dark: '#100B32', light: '#FFFFFF' },
    })
    // QRCode.toCanvas가 설정한 인라인 style.width/height 초기화 →
    // .qr-wrap canvas { width: Xpx } 등 외부 CSS가 화면 표시 크기를 지배
    canvas.style.width = ''
    canvas.style.height = ''
  } catch { /* 미설치 시 무시 */ }
}

/**
 * QR 캔버스에 라벨 텍스트를 합성해 PNG로 다운로드.
 * 기존 3곳(상품/예약/회원-CMS) 복붙 라벨합성 로직을 그대로 추출 — 동작 무변경.
 * 생성된 PNG에는 pHYs 300 DPI 메타데이터가 삽입됨.
 *
 * @param canvas    QR가 렌더링된 canvas 엘리먼트
 * @param label     QR 아래에 표시할 텍스트 (없으면 텍스트 없이 QR만 저장)
 * @param filename  다운로드 파일명 (확장자 .png 포함)
 */
export function downloadQrWithLabel(
  canvas: HTMLCanvasElement,
  label: string | null,
  filename: string,
): void {
  let pngDataUrl: string

  if (label) {
    const qrSize = canvas.width
    const fontSize = 11
    const padding = 6
    const textH = fontSize + padding * 2
    const out = document.createElement('canvas')
    out.width = qrSize
    out.height = qrSize + textH
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0)
    ctx.fillStyle = '#100B32'
    ctx.font = `700 ${fontSize}px "Noto Sans KR", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, qrSize / 2, qrSize + textH / 2)
    pngDataUrl = out.toDataURL('image/png')
  } else {
    pngDataUrl = canvas.toDataURL('image/png')
  }

  // PNG 바이트에 DPI 메타데이터 삽입
  const base64 = pngDataUrl.split(',')[1]
  if (!base64) {
    triggerDownload(pngDataUrl, filename)
    return
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const withDpi = injectPngPhysicalDpi(bytes, PNG_DPI)
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < withDpi.length; i += chunk) {
    b64 += String.fromCharCode(...withDpi.subarray(i, i + chunk))
  }
  const finalDataUrl = `data:image/png;base64,${btoa(b64)}`
  triggerDownload(finalDataUrl, filename)
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
