// 반납 등록 내역 → 상품 '이력' 자동 반영 (2026-11-12, Stephen 지시).
//  · 시점: 예약이 '완료'로 마감된 직후(검수 승인 approveInspection · 이슈 해소 resolveInspectionIssue) — 반납중·검수 칩에 있는 동안에는 반영하지 않는다.
//  · 대상: 완료된 예약에 배정된 재고(자식) 상품의 이력(product_history_records) 1건. 고객 반납 제출 사진 + 관리자 직접 등록 사진 + 검수 이슈 사진(코멘트=출처·항목 이름만 — 자유 문장은 복사하지 않음).
//  · 관리자 전용(2026-11-12, Stephen · sp5): 고객용 이력 조회(get_product_history_for_customer, Migration 818)는 주소에 /return_history/ 가 있는 이 이력을 제외한다.
//  · 사진: 비공개 저장소(return-evidence)에서 이력용 저장소(product-images)로 복사한다 — CMS 이력 탭은 공개 주소로 사진을 보여 주며, CMS는 관리자 전용 폐쇄 영역이라 공개 노출로 확정(Stephen).
//    서버에 이미지 리사이즈 도구가 없어 원본을 그대로 복사하고 썸네일 주소도 같은 파일을 쓴다. jpg·png·webp 만 복사하고 동영상·HEIC 등은 건너뛴다.
//  · 멱등: 이 예약의 복사 폴더(`{product_id}/return_history/{reservation_id}/`)에 파일이 이미 있으면 다시 만들지 않는다.
//  · 모두 fail-soft: 어떤 오류도 완료 처리(승인·해소)를 막지 않는다. 이력 기록에 실패하면 복사한 파일을 지워 다음에 다시 시도할 수 있게 한다.
import { RETURN_EVIDENCE_BUCKET } from '$lib/server/returnSubmission'
import { loadReturnPhotoItems } from '$lib/server/returnInspectionItems'
import { mediaItemLabel } from '$lib/utils/returnNotice'
import { issueTypeLabel } from '$lib/utils/inspection'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const HISTORY_BUCKET = 'product-images'
const MAX_IMAGES = 40
const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

interface PendingImage { path: string; comment: string }

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

async function collectImages(admin: AnyClient, reservationId: number): Promise<PendingImage[]> {
  const out: PendingImage[] = []

  // 1) 고객 반납 제출 사진
  const { data: sub } = await admin.from('reservation_return_submissions').select('id').eq('reservation_id', reservationId).maybeSingle()
  const subId = (sub as { id?: number } | null)?.id
  if (subId != null) {
    const { labelByKey } = await loadReturnPhotoItems(admin)
    const { data: media } = await admin
      .from('reservation_return_media')
      .select('item_key, storage_path, kind, sort_order')
      .eq('submission_id', subId)
      .order('sort_order', { ascending: true })
    for (const m of (media ?? []) as { item_key: string; storage_path: string; kind: string }[]) {
      if (m.kind !== 'photo') continue
      out.push({ path: m.storage_path, comment: `고객 반납 · ${labelByKey.get(m.item_key) ?? mediaItemLabel(m.item_key)}` })
    }
  }

  // 2) 관리자 직접 등록 사진
  const { data: entries } = await admin
    .from('reservation_return_admin_entries')
    .select('media, created_at')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: true })
  for (const e of (entries ?? []) as { media: { path: string; kind: string }[] | null }[]) {
    for (const m of e.media ?? []) {
      if (m.kind !== 'photo') continue
      out.push({ path: m.path, comment: '관리자 등록' }) // 관리자 메모(자유 문장)는 이력에 복사하지 않는다 — 검수 탭에서만 본다(보안 검수 SEC-003)
    }
  }

  // 3) 검수 이슈 사진
  const { data: issues } = await admin
    .from('reservation_inspection_issues')
    .select('issue_types, media, created_at')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: true })
  for (const i of (issues ?? []) as { issue_types: string[] | null; media: { path: string; kind: string }[] | null }[]) {
    const types = (i.issue_types ?? []).map(issueTypeLabel).join(', ') // 이슈 상세(자유 문장)는 복사하지 않고 항목 이름만 남긴다(보안 검수 SEC-003)
    for (const m of i.media ?? []) {
      if (m.kind !== 'photo') continue
      out.push({ path: m.path, comment: `검수 이슈 · ${types}` })
    }
  }

  return out.slice(0, MAX_IMAGES)
}

async function recordOne(admin: AnyClient, reservationId: number, adminId: string): Promise<void> {
  const { data: rr } = await admin.from('rental_reservations').select('product_id').eq('id', reservationId).maybeSingle()
  const productId = (rr as { product_id?: string } | null)?.product_id
  if (!productId) return

  const folder = `${productId}/return_history/${reservationId}`
  const { data: existing } = await admin.storage.from(HISTORY_BUCKET).list(folder, { limit: 1 })
  if (Array.isArray(existing) && existing.length > 0) return // 이미 반영됨(멱등)

  const pending = await collectImages(admin, reservationId)
  if (pending.length === 0) return

  const uploaded: string[] = []
  const images: { url: string; thumb_url: string; comment: string; display_order: number }[] = []
  for (const item of pending) {
    try {
      const { data: blob, error: dlErr } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).download(item.path)
      if (dlErr || !blob) continue
      const ext = IMAGE_EXT[blob.type]
      if (!ext) continue // jpg·png·webp 외(HEIC 등)는 브라우저에서 보이지 않아 건너뛴다
      const target = `${folder}/${images.length}_${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(HISTORY_BUCKET).upload(target, await blob.arrayBuffer(), { contentType: blob.type, upsert: false })
      if (upErr) continue
      uploaded.push(target)
      const url: string = admin.storage.from(HISTORY_BUCKET).getPublicUrl(target).data.publicUrl
      images.push({ url, thumb_url: url, comment: item.comment, display_order: images.length })
    } catch {
      /* 사진 한 장 복사 실패는 건너뛴다 */
    }
  }
  if (images.length === 0) return

  const { error } = await admin.rpc('upsert_product_history_record', {
    p_id: null,
    p_product_id: productId,
    p_recorded_date: kstToday(),
    p_images: images,
    p_user_id: adminId,
  })
  if (error) {
    console.warn('[recordReturnHistory] 이력 기록 실패:', reservationId, error.message)
    try { await admin.storage.from(HISTORY_BUCKET).remove(uploaded) } catch { /* 정리 실패는 무시 */ }
  }
}

/** 완료로 마감된 예약들의 반납 등록 사진을 각 재고 상품 이력에 반영한다. 예외를 던지지 않는다. */
export async function recordReturnHistoryForCompleted(admin: AnyClient, reservationIds: number[], adminId: string): Promise<void> {
  for (const id of reservationIds) {
    try {
      await recordOne(admin, id, adminId)
    } catch (e) {
      console.warn('[recordReturnHistory] 오류:', id, e instanceof Error ? e.message : e)
    }
  }
}
