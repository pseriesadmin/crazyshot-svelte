/**
 * loadMaterialIconsFont.ts — Google Material Icons 웹폰트 <link> 1회 주입
 *
 * 계약서 편집기 툴바(문서형 ContractDocumentEditor.svelte, 스프레드시트형
 * ContractSpreadsheetEditor.svelte)가 공유하는 아이콘 폰트 로더 — 2026-08-17
 * 편집 메뉴 UI 통일(Stephen "jspreadsheet 네이티브 툴바를 표준 디자인 UI로 기준" 요청)로
 * 두 컴포넌트가 동일한 아이콘 세트를 쓰게 되며 중복 정의를 이 파일로 추출.
 *
 * 전역 app.html에 넣으면 고객용 페이지까지 로드되므로, 실제로 아이콘을 쓰는
 * 컴포넌트가 마운트될 때만 동적으로 <link>를 주입한다(멱등 — 이미 있으면 스킵).
 */
export function ensureMaterialIconsFont(): void {
  const markerKey = 'material-icons'
  if (document.querySelector(`link[data-font-loader="${markerKey}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons'
  link.setAttribute('data-font-loader', markerKey)
  document.head.appendChild(link)
}
