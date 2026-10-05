// 크레이지로그 본문 미리보기 텍스트 (2026-10-05)
// 본문(content_blocks의 text 블록 html)에서 카드 부제목용 평문을 만든다. contenteditable 에디터는 선행·연속 공백을 '&nbsp;'로 저장하므로
// 태그만 제거하면 '&nbsp; &nbsp; …'가 그대로 화면에 노출됐다 — 태그는 공백으로 바꾸고 흔한 HTML 엔티티를 문자로 디코딩한 뒤 연속 공백을 하나로
// 정리·trim·최대 길이로 자른다. DB 함수 get_crazylog_posts_by_ids의 first_text(Migration #646)와 같은 규칙이어야 하므로 한쪽을 바꾸면 함께 바꾼다.
export function plainTextPreview(html: string, maxLength = 120): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/ /g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength)
}
