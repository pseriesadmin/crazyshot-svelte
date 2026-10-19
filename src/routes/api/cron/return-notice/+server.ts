/**
 * GET /api/cron/return-notice — 반납 방식별 단계 알림 (Vercel Cron, 10분 간격)
 *
 * 택배류: 반납 마지막 날 18:00 / 퀵: 반납시각 5·2·1시간 전 / 무인함: 2시간 전 (KST).
 * 단계 산출·중복 선점은 DB 함수 claim_return_notice_targets(Migration #722)가 원자적으로 한다 —
 * (예약, 단계)당 1회만 반환되므로 크론이 겹쳐 돌아도 같은 안내가 두 번 나가지 않는다.
 * 방문 반납은 기존 매일 09시 return-remind 크론이 그대로 맡는다.
 *
 * 발송 순서: ① 채팅카드(send_return_notice_card) ② 푸시+문자(sendReservationLifecyclePush — 허브가 같은 날 중복·로그 처리)
 *           ③ 퀵 2시간 전만 운영자 푸시.
 * 채팅카드 전달에 실패하면 선점을 되돌려(release_return_notice_claim) 다음 크론에서 재시도한다.
 * 인증: CRON_SECRET (fail-closed). 스케줄: vercel.json crons.
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { CUSTOMER_LIFECYCLE_PUSH_COPY, sendPushToAdmins, sendReservationLifecyclePush } from '$lib/server/push'
import {
  RETURN_NOTICE_ADMIN_PUSH_STAGES,
  RETURN_NOTICE_BUTTON_LABEL,
  RETURN_NOTICE_NOTIFY_TYPE,
  isReturnNoticeStage,
  returnSubmitPath,
} from '$lib/utils/returnNotice'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 50
const MAX_BATCHES = 5 // 최대 250건/실행 — 10분 간격 크론이라 locker-guide 와 같은 상한

interface ClaimedReturnNotice {
  reservation_id: number
  user_id: string
  stage: string
  return_method: string
  product_name: string | null
  return_at: string
}

export const GET: RequestHandler = async ({ request }) => {
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed)
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: { reservationId: number; stage: string; error: string }[] = []
  // 아무것도 전달하지 못한 건 — 루프가 끝난 뒤 선점을 되돌려 다음 크론에서 재시도(루프 도중에 되돌리면 같은 실행의 다음 배치가 즉시 다시 선점한다)
  const toRelease: { reservationId: number; stage: string }[] = []

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_return_notice_targets', { p_limit: BATCH_SIZE })
    if (claimError) {
      errors.push({ reservationId: -1, stage: '-', error: claimError.message })
      break
    }

    const rows = (claimed ?? []) as ClaimedReturnNotice[]
    if (rows.length === 0) break

    for (const row of rows) {
      processed++
      // 한 건의 실패가 나머지 배치를 막지 않도록 개별 격리
      try {
        if (!isReturnNoticeStage(row.stage)) throw new Error(`알 수 없는 단계: ${row.stage}`)
        const stage = row.stage
        const notifyType = RETURN_NOTICE_NOTIFY_TYPE[stage]
        const productName = row.product_name ?? '상품'
        const content = CUSTOMER_LIFECYCLE_PUSH_COPY[notifyType]?.body(productName)
        if (!content) throw new Error(`안내 문구 없음: ${notifyType}`)

        const { data: cardResult, error: cardError } = await admin.rpc('send_return_notice_card', {
          p_reservation_id: row.reservation_id,
          p_notify_type: notifyType,
          p_content: content,
          p_button_label: RETURN_NOTICE_BUTTON_LABEL[stage],
          p_action_url: returnSubmitPath(row.reservation_id),
        })
        const cardOk = !cardError && (cardResult as { ok?: boolean } | null)?.ok === true
        if (!cardOk) {
          toRelease.push({ reservationId: row.reservation_id, stage })
          throw new Error(cardError?.message ?? (cardResult as { error?: string } | null)?.error ?? '채팅카드 발송 실패')
        }

        // 푸시+문자(fail-soft — 내부에서 예외를 삼킨다)
        await sendReservationLifecyclePush(admin, row.reservation_id, notifyType)

        if (RETURN_NOTICE_ADMIN_PUSH_STAGES.includes(stage)) {
          try {
            await sendPushToAdmins('urgent_chat_message', {
              title: '퀵 반납 종료 2시간 전',
              body: `${productName} 반납 준비를 확인해 주세요.`,
              link: `/cms/rentals?selected=${row.reservation_id}`,
            })
          } catch {
            // 운영자 푸시 실패는 고객 안내에 영향 없음
          }
        }

        succeeded++
      } catch (err) {
        failed++
        errors.push({
          reservationId: row.reservation_id,
          stage: row.stage,
          error: err instanceof Error ? err.message : '알 수 없는 예외',
        })
      }
    }

    if (rows.length < BATCH_SIZE) break
  }

  for (const r of toRelease) {
    const { error: relErr } = await admin.rpc('release_return_notice_claim', { p_reservation_id: r.reservationId, p_stage: r.stage })
    if (relErr) errors.push({ reservationId: r.reservationId, stage: r.stage, error: `재시도 표시 복구 실패: ${relErr.message}` })
  }

  return json({ processed, succeeded, failed, retryScheduled: toRelease.length, errors })
}
