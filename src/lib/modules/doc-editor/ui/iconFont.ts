/**
 * iconFont.ts — Material Icons 웹폰트 <link> 1회 주입 (doc-editor 자체 구현, 호스트 유틸 비의존)
 *
 * 편집기가 마운트될 때만 주입하고(멱등), 호스트가 이미 로드했다면 DocEditor의 iconFontUrl={null}로 끈다.
 */
export const DEFAULT_ICON_FONT_URL = 'https://fonts.googleapis.com/icon?family=Material+Icons'

export function ensureIconFont(url: string = DEFAULT_ICON_FONT_URL): void {
  if (typeof document === 'undefined') return
  const markerKey = 'doc-editor-material-icons'
  if (document.querySelector(`link[data-font-loader="${markerKey}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.setAttribute('data-font-loader', markerKey)
  document.head.appendChild(link)
}
