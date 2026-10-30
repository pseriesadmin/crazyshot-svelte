/**
 * download.ts — 브라우저에서 파일(Blob)을 내 컴퓨터로 내려받기
 *
 * 임시 링크를 만들어 눌렀다가 곧바로 치운다. 주소(URL)는 내려받기가 시작될 시간을 준 뒤 해제한다.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
