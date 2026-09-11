/**
 * POST /api/auth/legacy-claim/send-otp
 *
 * 레거시 회원 OTP 발송 엔드포인트
 *
 * ⛔ 2026-09-11 정책 변경(Stephen 지시) — 아래 열거공격 방지 원칙 중 "응답 바디를 항상
 *   동일하게 반환"만 의도적으로 해제했다. 이 화면(LegacyMemberVerifyModal)은 불특정
 *   다수가 시도하는 로그인/회원가입 폼이 아니라 이미 로그인 진입 화면 안에 있는 "기존
 *   고객 인증" 좁은 플로우라 열거공격 실익이 낮다고 판단 — 반대로 매칭 실패를 숨기면
 *   CS/QA가 "SMS 미발송이 코드 버그인지 단순 미매칭(DB에 해당 레거시 회원 데이터가
 *   없음)인지"를 구분할 수 없어 매번 재조사가 필요했던 실사용 불편이 더 컸다. 응답
 *   바디에 `found: boolean`을 추가해 클라이언트가 명시적으로 분기(경고 토스트)할 수
 *   있게 한다 — 응답 "시간" 하한(MIN_RESPONSE_MS)은 그대로 유지(타이밍 사이드채널
 *   방지 목적은 이 변경과 무관하게 여전히 유효).
 *
 * 열거공격 방지(Enumeration Attack Prevention) — 나머지는 그대로 유지:
 *   - 실제 SMS 발송은 매칭 성공 시에만 수행
 *   - 응답 "시간"도 최소 MIN_RESPONSE_MS 이하로 내려가지 않도록 하한을 둔다 — 매칭 실패 시
 *     DB write 2회 + 실제 SMS API 호출이 통째로 스킵돼 매칭 성공 대비 응답이 눈에 띄게
 *     빨라지는 타이밍 사이드채널이 있었다(2026-09-10 GATE E 재검수로 발견·수정). SMS를
 *     스킵하는 자체는 유지하되(실제 존재하지 않는 번호로 스팸 발송 방지), 그 대신 전체
 *     핸들러의 총 소요시간을 하한으로 맞춰 응답 시점만으로 매칭 여부를 추정할 수 없게 한다.
 */

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { sendSms } from '$lib/server/sms'
import type { RequestHandler } from './$types'

// 매칭 성공 경로(RPC 1회 + DB write 2회 + SMS API 호출)의 통상 소요시간보다 넉넉히 높게 잡은
// 최소 응답시간 하한 — 매칭 실패 시에도 이 시간이 될 때까지 대기 후 응답한다.
const MIN_RESPONSE_MS = 700

export const POST: RequestHandler = async ({ request }) => {
  const startedAt = Date.now()
  const body = await request.json().catch(() => null)
  const name  = typeof body?.name  === 'string' ? body.name.trim()  : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''

  const respond = async (found: boolean) => {
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed))
    }
    return json({ ok: true, found })
  }

  // 기본 입력 검증 실패 → 매칭 실패와 동일하게 처리(found: false)
  if (!name || !phone || !/^01[0-9]\d{7,8}$/.test(phone)) {
    return respond(false)
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return respond(false)

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // find_legacy_member RPC — SECURITY DEFINER, service_role 전용
  const { data: member, error: rpcError } = await admin.rpc('find_legacy_member', {
    p_name: name,
    p_phone: phone,
  })
  if (rpcError) {
    // RPC 자체 실패(권한 문제·함수 미존재 등)는 서버 로그로만 남기고, 응답은 매칭 실패와
    // 동일하게 처리한다 — 에러 유무를 클라이언트에 노출하면 열거공격 방지 원칙이 깨진다.
    console.error('[legacy-claim/send-otp] find_legacy_member RPC error:', rpcError.message)
  }

  // OTP 생성 (매칭 성공 여부와 무관하게 항상 생성 → 타이밍 동일화)
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString()

  if (member) {
    // 매칭 성공: OTP 저장 + SMS 발송
    // 이전 미완료 OTP는 중복 방지를 위해 만료 처리 (같은 전화번호 기존 행 claimed_at/verified_at NULL인 것)
    await admin
      .from('legacy_claim_otps')
      .update({ expires_at: new Date().toISOString() }) // 즉시 만료
      .eq('phone', phone)
      .is('claimed_at', null)
      .is('verified_at', null)

    await admin.from('legacy_claim_otps').insert({
      phone,
      code,
      expires_at: expiresAt,
    })

    // SMS 발송 (env 미설정 시 graceful skip — sms.ts 내부 처리)
    await sendSms(phone, `[CRAZYSHOT.KR] 본인확인 인증번호 [${code}]을 화면에 입력해주세요. (유효시간 3분)`)
  }
  // 매칭 실패 시: OTP를 저장하지 않는다 (SMS 스팸 방지 목적은 유지, 응답 내용만 명시적으로 안내)

  // 응답 구조는 동일 + found로 매칭 여부만 명시 + 동일한 최소 응답시간 반환
  return respond(Boolean(member))
}
