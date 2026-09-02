// GET /api/cms/chat/pending-inquiries — 상담채팅 패널(AdminChatPanel) 세션 목록에 "빠른문의
// 답변등록" 리마인더 카드로 노출할 미답변(status='open') 빠른문의(cs_posts) 목록.
//
// 2026-09-02: 과거 Migration 328은 이 알림을 관리자에게 전달하려고 문의를 남긴 고객 본인의
// 채팅 세션(chat_messages)에 카드를 삽입했는데, 이 스키마엔 "관리자 전용 채널" 개념이
// 없어(고객 1명당 세션 1개, chat_sessions/chat_messages 어디에도 audience 구분 컬럼 없음)
// 그 카드가 고객 화면에도 그대로 노출되는 구조적 결함이었다(Migration 425로 제거). 이
// 엔드포인트는 그 대체 경로 — chat_messages와 완전히 무관한, CMS 전용 UI 데이터다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

export interface PendingInquiryCard {
  id: string
  title: string
  created_at: string
}

export const GET: RequestHandler = async ({ locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  // /cms/customers/inquiry 페이지 자체와 동일한 게이트(manager 이상) — security-auth.md
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin.rpc('get_all_cs_posts', {
    p_status: 'open',
    p_search: null,
    p_page: 1,
    p_limit: 10,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{ id: string; title: string; created_at: string }>
  const posts: PendingInquiryCard[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
  }))

  return json({ posts })
}
