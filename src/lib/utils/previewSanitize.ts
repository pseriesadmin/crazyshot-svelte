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

/**
 * 원본 HTML을 안전하게 "보기만" 하기 위한 샌드박스 iframe용 문서(srcdoc).
 *  - iframe에는 sandbox="" (allow-* 없음)를 함께 쓴다: 스크립트·폼·팝업·최상위 이동·same-origin 전부 차단(opaque origin)
 *  - CSP로 네트워크도 이미지(https/data)와 인라인 스타일만 허용 — 스크립트·프레임·외부 폰트·연결 차단
 * 정화(파싱→직렬화)와 달리 원본을 한 글자도 바꾸지 않고 보여주며, 정화 우회(mXSS)에도 영향받지 않는다.
 */
export function buildSandboxedPreviewDoc(html: string): string {
  const csp = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:"
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0}body{padding:10px 14px;font:14px/1.7 -apple-system,"Noto Sans KR",sans-serif;color:#444;word-break:break-word;overflow:hidden}img{max-width:100%;height:auto}</style>' +
    `</head><body>${html}</body></html>`
  )
}
