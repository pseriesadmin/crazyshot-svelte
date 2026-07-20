/**
 * DB membership_grade 값에서 표시용 등급을 반환한다.
 * 'NONE' 또는 null·undefined → null (배지 미노출)
 * 실제 구독 등급(PREMIUM, CREATOR 등) → 그대로 반환
 */
export function resolveGrade(raw: string | null | undefined): string | null {
	if (!raw || raw === 'NONE') return null
	return raw
}
