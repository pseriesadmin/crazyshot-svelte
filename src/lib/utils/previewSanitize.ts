/**
 * 편집 화면 미리보기용 최소 정화(브라우저 전용).
 * 서버가 이미 허용 목록 기준으로 정화한 값이 오지만, "원본 HTML 편집"으로 사용자가 입력한 값이 편집 화면에서
 * 바로 실행되지 않도록 위험 요소(스크립트·iframe·이벤트 속성·javascript: 링크)만 걷어낸다. 저장값은 건드리지 않는다.
 */
const DROP_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'video', 'audio', 'svg', 'math', 'noscript', 'template', 'textarea', 'details']

export function sanitizeForPreview(html: string): string {
  if (typeof DOMParser === 'undefined' || !html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const tag of DROP_TAGS) doc.body.querySelectorAll(tag).forEach((el) => el.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|data|vbscript):/.test(value))) {
        el.removeAttribute(attr.name)
      }
    }
  })
  return doc.body.innerHTML
}
