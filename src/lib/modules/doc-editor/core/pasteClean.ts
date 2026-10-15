/**
 * pasteClean.ts — 붙여넣기 HTML 정리 (doc-editor core, 순수 함수)
 *
 * 이관 원본: RichContentEditor 의 cleanPastedHtml (원본은 무변경 유지, 동일 규칙).
 * 워드·엑셀·웹 복사본에서 편집에 방해되는 주석·스타일/스크립트·메타 태그·MS Office 전용 스타일·원본 서체 지정을 제거한다.
 * (원본 서체를 지우는 이유: 붙여넣은 글자가 문서 서체와 따로 놀지 않게 하기 위함 — 서체는 툴바로 지정)
 */
export function cleanPastedHtml(html: string): string {
  // 편집기 안에서 복사·붙여넣기한 조각(ProseMirror 가 data-pm-slice 를 붙임)은 이미 정리된 문서 내용이므로 그대로 둔다(사용자가 지정한 서체 유지)
  if (html.includes('data-pm-slice')) return html
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(meta|link)\b[^>]*>/gi, '')
    .replace(/font-family\s*:[^;"]*;?/gi, '')
    .replace(/mso-[^;"]*;?/gi, '')
}
