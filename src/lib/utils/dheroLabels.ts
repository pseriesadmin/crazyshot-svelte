// src/lib/utils/dheroLabels.ts
// 두발히어로 상태 코드 → 사람이 읽을 수 있는 텍스트 (단일 정의 — 서버·클라이언트 공유)
//
// 정본: PDF "두발히어로 배송 api 안내" status 코드 목록 (MEDIUM-2 수정 — 기존 중복·오표기 통합)
//
// 수정 이력:
//   2026-08-25: RentalDetailPanel.svelte의 클라이언트 측 중복 정의(잘못된 매핑값 포함)를
//   제거하고 서버(dhero.ts)의 PDF 스펙 일치 버전을 이 파일로 통합. dhero.ts는 이 파일에서
//   re-export, RentalDetailPanel.svelte는 이 파일에서 직접 import.

export const DHERO_STATUS_LABEL: Record<number, string> = {
  0:  '배송접수',
  1:  '수거배차',
  2:  '수거완료',
  3:  '입고완료',
  4:  '출고완료',
  5:  '배송완료',
  6:  '반송완료',
  7:  '분실완료',
  8:  '배송대기',
  12: '배송연기',
}
