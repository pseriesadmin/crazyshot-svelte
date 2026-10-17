import { error } from '@sveltejs/kit'
import { dev } from '$app/environment'

// 편집기 자동 검증(Playwright) 전용 화면 — 개발 서버에서만 열리고 배포 빌드에서는 404
export const ssr = false
export const load = () => {
  if (!dev) throw error(404, 'Not found')
}
