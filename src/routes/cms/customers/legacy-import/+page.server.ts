import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { parseCsv, groupByPhone, type CsvRow, type PhoneGroup } from '$lib/server/legacyCsvImport'
import type { Actions, PageServerLoad } from './$types'

// parseCsv/groupByPhone/CsvRow/PhoneGroup는 $lib/server/legacyCsvImport.ts로 이관됨
// (2026-09-11 — SvelteKit이 +page.server.ts의 런타임 함수 export를 허용하지 않아
// "Invalid export 'parseCsv'" 500 에러로 이 화면이 한 번도 로드된 적 없었던 결함 수정).
// 타입은 아래에서 그대로 재노출(export type — 런타임 export가 아니라 SvelteKit 제약과 무관).
export type { CsvRow, PhoneGroup }

/** 확정 등록 시 서버 액션 결과 */
export interface ImportResult {
  email: string
  status: 'success' | 'skipped' | 'error'
  reason?: string
}

/** legacy_member_staging 대기(미클레임) 행 — CMS "미인증 대기 목록" 탭 표시용 */
export interface StagingRow {
  id: string
  full_name: string
  phone: string | null
  email: string
  legacy_source: string | null
  legacy_signup_at: string | null
  legacy_purchase_count: number
  imported_at: string
}

// ─── load ──────────────────────────────────────────────────────
export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  // manager 이상만 허용 (QR-CASE-2 선례와 동일 패턴)
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { pendingStaging: [] as StagingRow[] }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data: pendingStaging } = await admin
    .from('legacy_member_staging')
    .select('id, full_name, phone, email, legacy_source, legacy_signup_at, legacy_purchase_count, imported_at')
    .order('imported_at', { ascending: false })
    .limit(500)

  return { pendingStaging: (pendingStaging ?? []) as StagingRow[] }
}

// ─── actions ───────────────────────────────────────────────────
export const actions: Actions = {
  // Step 1: CSV 텍스트를 파싱해 그룹 미리보기 반환
  preview: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const form = await request.formData()
    const csvText = form.get('csv_text') as string | null

    if (!csvText || csvText.trim().length === 0) {
      return fail(400, { error: 'CSV 내용을 입력해주세요.' })
    }
    if (csvText.length > 500_000) {
      return fail(400, { error: 'CSV가 너무 큽니다. 500KB 이하로 입력해주세요.' })
    }

    const rows = parseCsv(csvText)
    if (rows.length === 0) {
      return fail(400, { error: '유효한 데이터 행이 없습니다. CSV 형식을 확인해주세요.' })
    }

    const groups = groupByPhone(rows)
    return { ok: true, groups, totalRows: rows.length }
  },

  // Step 2: 확정 등록 — legacy_member_staging INSERT (auth.users/user_profiles와 완전 격리,
  // 2026-09-11 재설계 — 실 계정 생성은 본인이 OTP 인증을 완료하는 시점(complete 엔드포인트)
  // 으로 이동됨. 상세 배경: supabase/migrations/20260911100000_489_legacy_member_staging.sql)
  confirm: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류' })

    const form = await request.formData()
    const groupsJson = form.get('groups_json') as string | null

    if (!groupsJson) return fail(400, { error: '등록 데이터가 없습니다.' })

    let groups: PhoneGroup[]
    try {
      groups = JSON.parse(groupsJson) as PhoneGroup[]
    } catch {
      return fail(400, { error: '그룹 데이터 파싱 오류' })
    }

    // EC-5: 그룹 크기 ≥2인 그룹에서 representEmail 미선택 검증
    for (const g of groups) {
      if (g.excluded) continue
      if (g.rows.length >= 2 && !g.representEmail) {
        return fail(400, {
          error: `대표 이메일을 선택해주세요 (전화번호: ${g.phone ?? '없음'})`,
        })
      }
    }

    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const results: ImportResult[] = []
    const now = new Date().toISOString()

    for (const group of groups) {
      if (group.excluded) continue

      const email = group.representEmail
      if (!email) {
        // 전화번호 없는 행(EC-3)에서 이메일도 없는 경우 스킵
        results.push({ email: '(이메일 없음)', status: 'skipped', reason: '이메일 없음' })
        continue
      }

      // 대표 행 정보 (이메일 기준으로 매칭)
      const repRow = group.rows.find((r) => r.email === email) ?? group.rows[0]
      const phone = group.phone ?? null
      const signupAtTs = repRow.signupAt ? new Date(repRow.signupAt).toISOString() : null

      // EC-1(재정의): 이미 정식 가입(또는 인증완료로 승격)된 계정이면 스킵 — 데이터 절대 보존
      const { data: existingProfile } = await admin
        .from('user_profiles')
        .select('user_id')
        .eq('email', email)
        .is('deleted_at', null)
        .maybeSingle()
      if (existingProfile) {
        results.push({ email, status: 'skipped', reason: '이미 정식 가입(또는 인증완료)된 계정' })
        continue
      }

      // 이미 스테이징된 미인증 레거시 후보 → 재임포트 스킵
      const { data: existingStaging } = await admin
        .from('legacy_member_staging')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (existingStaging) {
        results.push({ email, status: 'skipped', reason: '이미 선등록된 레거시 후보(미인증)' })
        continue
      }

      const { error: insertErr } = await admin.from('legacy_member_staging').insert({
        full_name: repRow.name,
        phone,
        email,
        legacy_source: repRow.source,
        legacy_signup_at: signupAtTs,
        legacy_purchase_count: group.totalPurchaseCount,
        imported_at: now,
      })

      if (insertErr) {
        results.push({ email, status: 'error', reason: `스테이징 등록 실패: ${insertErr.message}` })
        continue
      }

      results.push({ email, status: 'success' })
    }

    const successCount = results.filter((r) => r.status === 'success').length
    const skippedCount = results.filter((r) => r.status === 'skipped').length
    const errorCount = results.filter((r) => r.status === 'error').length

    return {
      ok: true,
      results,
      summary: { successCount, skippedCount, errorCount },
    }
  },
}
