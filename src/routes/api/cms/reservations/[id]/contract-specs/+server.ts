// GET·PUT /api/cms/reservations/[id]/contract-specs — 예약별 계약 특약 사전 등록(2026-10-15, Migration #720)
// 계약서 발행 전에 그 예약 건만의 특약을 [{key,value}]로 저장해 두면 전자계약 발행(자동·수동) 때 양식 특약 뒤에 이어 붙는다.
//  · 권한: 계약서 발행과 같은 등급 — 메뉴 rental.reservation + manager 이상
//  · 취소·만료 예약은 저장 불가, 이미 발송된 계약서가 있어도 저장은 되지만 그 계약서에는 반영되지 않는다(화면이 발행 전에만 노출)
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { normalizeContractSpecs, type ContractSpecRow } from '$lib/utils/contractSpecs'
import { updateSpecialNotesInHtml } from '$lib/utils/contract-substitution'

async function orderReservationIds(admin: SupabaseClient, reservationId: number): Promise<number[]> {
  const ids = [reservationId]
  const { data: own } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (own as { order_id: number | null } | null)?.order_id
  if (orderId == null) return ids
  const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  for (const r of (sibs ?? []) as Array<{ reservation_id: number | null }>) {
    if (r.reservation_id != null && !ids.includes(r.reservation_id)) ids.push(r.reservation_id)
  }
  return ids
}

async function guard(locals: App.Locals, idParam: string): Promise<Response | { id: number }> {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ error: '권한 없음' }, { status: 403 })
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  return { id }
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const g = await guard(locals, params.id)
  if (g instanceof Response) return g
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.from('rental_reservations').select('contract_specifications').eq('id', g.id).maybeSingle()
  if (error) return json({ specifications: [] }) // 컬럼이 없는 환경(마이그레이션 전)은 특약 없음으로 본다
  return json({ specifications: normalizeContractSpecs((data as { contract_specifications?: unknown } | null)?.contract_specifications) })
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const g = await guard(locals, params.id)
  if (g instanceof Response) return g
  const body = await request.json().catch(() => null) as { specifications?: unknown } | null
  if (!body || !Array.isArray(body.specifications)) return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const specs = normalizeContractSpecs(body.specifications)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: res } = await admin.from('rental_reservations').select('status, contract_specifications').eq('id', g.id).maybeSingle()
  if (!res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })
  const status = (res as { status: string }).status
  const previousSpecs = normalizeContractSpecs((res as { contract_specifications?: unknown }).contract_specifications)
  if (status === 'cancelled' || status === 'expired') return json({ error: '취소·만료된 예약은 특약을 저장할 수 없어요.' }, { status: 409 })

  const { error } = await admin.from('rental_reservations')
    .update({ contract_specifications: specs.length > 0 ? specs : null })
    .eq('id', g.id)
  if (error) return json({ error: '특약 저장에 실패했습니다.' }, { status: 500 })

  // 이미 생성됐지만 아직 고객에게 발송되지 않은 계약서가 있으면 그 계약서의 특약도 함께 바꾼다 — 이전에 사전 등록했던 특약만 빼고 새 특약을 이어 붙인다.
  // 발송·서명이 끝난 계약서는 절대 건드리지 않는다.
  let contractUpdated = false
  let contractLocked = false
  try {
    // 계약서는 주문당 1건 — 같은 주문의 형제 예약에 붙어 있을 수 있어 주문 전체 예약 id로 찾는다(삭제된 계약서 제외)
    const orderIds = await orderReservationIds(admin, g.id)
    const { data: contract } = await admin
      .from('contracts')
      .select('id, specifications, html_document')
      .in('reservation_id', orderIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (contract) {
      const c = contract as { id: string; specifications: unknown; html_document: string | null }
      const { data: sign } = await admin.from('contract_signings').select('sent_at, signed_at').eq('contract_id', c.id)
      const locked = ((sign ?? []) as Array<{ sent_at: string | null; signed_at: string | null }>).some(x => x.sent_at || x.signed_at)
      if (locked) {
        contractLocked = true
      } else {
        const existing = Array.isArray(c.specifications) ? normalizeContractSpecs(c.specifications) : []
        const remaining: ContractSpecRow[] = [...existing]
        for (const old of previousSpecs) {
          const idx = remaining.findIndex(r => r.key === old.key && r.value === old.value)
          if (idx >= 0) remaining.splice(idx, 1)
        }
        const merged = [...remaining, ...specs]
        const payload: Record<string, unknown> = { specifications: merged, updated_at: new Date().toISOString() }
        if (c.html_document) payload.html_document = updateSpecialNotesInHtml(c.html_document, merged)
        const { error: upErr } = await admin.from('contracts').update(payload).eq('id', c.id)
        if (!upErr) contractUpdated = true
      }
    }
  } catch (e) {
    console.error('[contract-specs] 생성된 계약서 특약 갱신 실패(fail-soft):', e instanceof Error ? e.message : String(e))
  }
  return json({ ok: true, specifications: specs, contractUpdated, contractLocked })
}
