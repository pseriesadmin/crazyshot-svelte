import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/server/returnInspectionItems', () => ({
  loadReturnPhotoItems: async () => ({ active: [], labelByKey: new Map([['body', '본체 사진']]) }),
}))
import { recordReturnHistoryForCompleted } from '$lib/server/recordReturnHistory'

interface Setup {
  productId?: string | null
  submissionMedia?: { item_key: string; storage_path: string; kind: 'photo' | 'video' }[]
  adminEntries?: { memo: string | null; media: { path: string; kind: 'photo' | 'video' }[] }[]
  issues?: { issue_types: string[]; detail: string | null; media: { path: string; kind: 'photo' | 'video' }[] }[]
  existingFiles?: string[]
  fileTypes?: Record<string, string>
  rpcError?: boolean
}

function fake(s: Setup) {
  const uploads: string[] = []
  const removed: string[] = []
  const rpcCalls: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: async () => {
          if (table === 'rental_reservations') return { data: s.productId === null ? null : { product_id: s.productId ?? 'prod-1' } }
          if (table === 'reservation_return_submissions') return { data: s.submissionMedia ? { id: 7 } : null }
          return { data: null }
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'reservation_return_media') return resolve({ data: s.submissionMedia ?? [] })
          if (table === 'reservation_return_admin_entries') return resolve({ data: s.adminEntries ?? [] })
          if (table === 'reservation_inspection_issues') return resolve({ data: s.issues ?? [] })
          return resolve({ data: [] })
        },
      })
      return q
    },
    storage: {
      from(bucket: string) {
        return {
          list: async () => ({ data: bucket === 'product-images' ? (s.existingFiles ?? []).map((name) => ({ name })) : [], error: null }),
          download: async (path: string) => ({ data: new Blob(['x'], { type: s.fileTypes?.[path] ?? 'image/jpeg' }), error: null }),
          upload: async (path: string) => { uploads.push(path); return { error: null } },
          remove: async (paths: string[]) => { removed.push(...paths); return { error: null } },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
        }
      },
    },
    rpc: async (_n: string, a: Record<string, unknown>) => {
      rpcCalls.push(a)
      return s.rpcError ? { data: null, error: { message: 'boom' } } : { data: 'hist-1', error: null }
    },
  }
  return { client: client as never, uploads, removed, rpcCalls }
}

describe('recordReturnHistoryForCompleted — 완료된 예약의 반납 사진을 상품 이력에 자동 반영', () => {
  it('고객 제출·관리자 등록·검수 이슈 사진을 이력용 저장소로 복사해 이력 1건으로 기록한다', async () => {
    const f = fake({
      submissionMedia: [{ item_key: 'body', storage_path: 'r/1/body.jpg', kind: 'photo' }],
      adminEntries: [{ memo: '현장 확인', media: [{ path: 'r/1/a.jpg', kind: 'photo' }] }],
      issues: [{ issue_types: ['missing_part'], detail: '렌즈캡 없음', media: [{ path: 'r/1/i.jpg', kind: 'photo' }] }],
    })
    await recordReturnHistoryForCompleted(f.client, [1], 'admin-1')
    expect(f.uploads.length).toBe(3)
    expect(f.uploads.every((p) => p.startsWith('prod-1/return_history/1/'))).toBe(true)
    expect(f.rpcCalls.length).toBe(1)
    const images = f.rpcCalls[0].p_images as { url: string; thumb_url: string; comment: string; display_order: number }[]
    expect(images.map((i) => i.comment)).toEqual(['고객 반납 · 본체 사진', '관리자 등록', '검수 이슈 · 구성품 누락'])
    // 관리자 메모·이슈 상세 같은 자유 문장은 이력 코멘트에 들어가지 않는다
    expect(JSON.stringify(images)).not.toContain('현장 확인')
    expect(JSON.stringify(images)).not.toContain('렌즈캡')
    expect(images.map((i) => i.display_order)).toEqual([0, 1, 2])
    expect(images[0].url).toBe(images[0].thumb_url)
    expect(f.rpcCalls[0].p_product_id).toBe('prod-1')
    expect(f.rpcCalls[0].p_user_id).toBe('admin-1')
  })
  it('동영상·이미지가 아닌 파일은 건너뛰고, 복사할 사진이 없으면 이력을 만들지 않는다', async () => {
    const f = fake({ submissionMedia: [{ item_key: 'body', storage_path: 'r/1/v.mp4', kind: 'video' }, { item_key: 'body', storage_path: 'r/1/h.heic', kind: 'photo' }], fileTypes: { 'r/1/h.heic': 'image/heic' } })
    await recordReturnHistoryForCompleted(f.client, [1], 'admin-1')
    expect(f.uploads.length).toBe(0)
    expect(f.rpcCalls.length).toBe(0)
  })
  it('이미 이 예약의 이력 사진이 복사돼 있으면 다시 만들지 않는다(중복 방지)', async () => {
    const f = fake({ submissionMedia: [{ item_key: 'body', storage_path: 'r/1/body.jpg', kind: 'photo' }], existingFiles: ['0_x.jpg'] })
    await recordReturnHistoryForCompleted(f.client, [1], 'admin-1')
    expect(f.uploads.length).toBe(0)
    expect(f.rpcCalls.length).toBe(0)
  })
  it('이력 기록에 실패하면 복사한 파일을 지워 다음에 다시 시도할 수 있게 하고 예외를 던지지 않는다', async () => {
    const f = fake({ submissionMedia: [{ item_key: 'body', storage_path: 'r/1/body.jpg', kind: 'photo' }], rpcError: true })
    await expect(recordReturnHistoryForCompleted(f.client, [1], 'admin-1')).resolves.toBeUndefined()
    expect(f.removed.length).toBe(1)
  })
  it('예약을 찾지 못해도 예외 없이 지나간다', async () => {
    const f = fake({ productId: null })
    await expect(recordReturnHistoryForCompleted(f.client, [9], 'admin-1')).resolves.toBeUndefined()
    expect(f.rpcCalls.length).toBe(0)
  })
})
