import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

/**
 * 크레이지로그 글 관리 권한 — DB의 can_delete_user_post(Migration #647)와 같은 규칙이다. 한쪽만 바꾸지 말 것.
 *  · 수정·비공개: 작성자 본인 또는 모든 관리자(cms_role 보유, 파트너 포함)
 *  · 삭제: 작성자 본인 / 작성자가 관리자 계정인 글은 모든 관리자 / 일반 사용자 글은 매니저 이상
 * 화면은 버튼 노출만 결정하고, 실제 집행은 DB(RPC·트리거)가 한다.
 */
export interface PostPermissionInput {
	/** 보는 사람이 글 작성자 본인인가 */
	isOwner: boolean
	/** 보는 사람의 cms_role (관리자가 아니면 null) */
	viewerRole: string | null
	/** 글 작성자가 관리자 계정(cms_role 보유)인가 */
	authorIsAdmin: boolean
}

/** 수정·비공개 전환 가능 여부 */
export function canManagePost({ isOwner, viewerRole }: PostPermissionInput): boolean {
	return isOwner || !!viewerRole
}

/** 삭제 가능 여부 */
export function canDeletePost({ isOwner, viewerRole, authorIsAdmin }: PostPermissionInput): boolean {
	if (isOwner) return true
	if (!viewerRole) return false
	if (authorIsAdmin) return true
	return hasSettingsAccess(viewerRole)
}

/** DB가 삭제를 거부했을 때(사용자 글을 파트너가 삭제 시도) 보여줄 문구 — 그 외 오류는 원문 유지 */
export function describePostActionError(message: string | undefined): string {
	if (message && message.includes('manager role required')) {
		return '사용자가 작성한 글은 매니저 이상만 삭제할 수 있습니다.'
	}
	return message ?? '처리 중 오류가 발생했습니다.'
}
