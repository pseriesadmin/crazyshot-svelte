import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { redirect, error } from '@sveltejs/kit'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import type { PageServerLoad } from './$types'

// 회원 QR(`/qr/member/{member_code}` 페이로드) 스캔 랜딩 — 회원코드를 user_id로 조회한 뒤
// 이번 세션에 이미 구축된 /cms/customers 딥링크(selected/tab)로 리다이렉트한다.
// 신규 UI·RPC 없음 — 순수 조회 후 기존 화면 재사용.
export const load: PageServerLoad = async ({ params, parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(getSupabaseUrl(), SUPABASE_SERVICE_ROLE_KEY)

  // QR-CASE-1과 동일 원칙 — 회원코드도 override 접두어 사용 시 소문자가 섞여 채번될 수 있어
  // ilike + escapeLikePattern으로 대소문자 무관 정확 매칭
  const { data } = await admin
    .from('user_profiles')
    .select('id')
    .ilike('member_code', escapeLikePattern(params.code))
    .is('deleted_at', null)
    .maybeSingle()

  if (!data) throw error(404, '회원 QR을 확인할 수 없습니다.')

  throw redirect(303, `/cms/customers?selected=${(data as { id: string }).id}&tab=rental`)
}
