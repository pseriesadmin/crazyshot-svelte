// src/lib/utils/iosPwa.ts
// iOS Safari "홈 화면에 추가" 안내 배너 판정 헬퍼 — 순수 브라우저 감지 로직만 담당
// (iOS 16.4+ Safari는 standalone(홈 화면 설치) 웹앱에서만 Web Push를 허용하는 플랫폼 제약이
// 있어, 배너를 통해 설치를 유도한다 — service-operations.md §15 참고)

export const IOS_A2HS_DISMISSED_KEY = 'cs-ios-a2hs-dismissed'

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isClassicIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
  // iPadOS 13+는 UA에서 데스크탑 Safari로 위장하므로 터치 포인트로 별도 판별
  const isIPadOS13Up = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return isClassicIOS || isIPadOS13Up
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function shouldShowIosAddToHomeScreenBanner(): boolean {
  if (typeof window === 'undefined') return false
  if (!isIOSDevice() || isStandaloneDisplayMode()) return false
  return window.localStorage.getItem(IOS_A2HS_DISMISSED_KEY) !== 'true'
}

export function dismissIosAddToHomeScreenBanner(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(IOS_A2HS_DISMISSED_KEY, 'true')
}
