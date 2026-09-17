/**
 * qrPrinter.ts — QR 프린터 타입 정의 + 기능 감지
 *
 * 블루투스 QR 프린터 연동을 위한 타입 선언만 포함.
 * UI 버튼·인쇄 실행 로직은 이 파일에 넣지 않는다 — 별도 컴포넌트에서 담당.
 */

/** 프린트 작업 상태 */
export type QrPrintJobStatus = 'idle' | 'connecting' | 'ready' | 'printing' | 'error'

/** 단일 QR 프린트 작업 */
export interface QrPrintJob {
  /** 인쇄할 QR payload (product_code 또는 `{code}|{category}` 형식) */
  payload: string
  /** QR 아래에 표시할 레이블 (없으면 생략) */
  label?: string
  /** 인쇄 매수 (기본 1) */
  copies?: number
}

/** 프린터 기능 정보 */
export interface QrPrinterCapability {
  /** Bluetooth Web API 지원 여부 */
  bluetoothSupported: boolean
  /** 브라우저가 HTTPS 컨텍스트인지 여부 (Bluetooth API 필수 조건) */
  secureContext: boolean
}

/**
 * 현재 브라우저의 블루투스 프린터 지원 여부 감지.
 * navigator.bluetooth 존재 여부만 체크 — 실제 연결 시도는 하지 않는다.
 */
export function detectBluetoothPrinterSupport(): QrPrinterCapability {
  const bluetoothSupported =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator
  const secureContext =
    typeof window !== 'undefined' && window.isSecureContext
  return { bluetoothSupported, secureContext }
}
