/**
 * docStore.ts — 문서·양식 저장소 (Supabase 어댑터, 이식용)
 *
 * 서버 코드(+page.server.ts / +server.ts)에서 service_role(또는 RLS를 통과하는) 클라이언트를 주입해 쓴다.
 * 이 파일은 클라이언트를 만들지 않는다(키·환경변수를 알 필요가 없다) — 이식성의 핵심.
 * 삭제는 항상 소프트 삭제(deleted_at). 오류는 throw 하지 않고 {data, error} 로 돌려준다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTiptapDocBlock } from '../../core/types'
import type { DocTemplateInput, DocTemplatePatch, DocTemplateRow, StoreResult } from './types'

const TABLE = 'doc_templates'
const COLUMNS = 'id,title,kind,content,meta,status,created_at,updated_at,deleted_at'

function validateContent(content: unknown): string | null {
  if (!Array.isArray(content)) return 'content 는 배열이어야 합니다.'
  if (content.length !== 1 || !isTiptapDocBlock(content[0])) {
    return "content 는 [{ type:'tiptap-doc', doc }] 형태(원소 1개)여야 합니다."
  }
  return null
}

export function createDocStore(client: SupabaseClient) {
  return {
    /** 삭제되지 않은 문서 목록(최근 수정 순). 본문(content)은 목록에서 제외해 가볍게 가져온다. */
    async list(opts: { kind?: string } = {}): Promise<StoreResult<Omit<DocTemplateRow, 'content'>[]>> {
      let q = client.from(TABLE).select('id,title,kind,meta,status,created_at,updated_at,deleted_at').is('deleted_at', null)
      if (opts.kind) q = q.eq('kind', opts.kind)
      const { data, error } = await q.order('updated_at', { ascending: false })
      return { data: (data as Omit<DocTemplateRow, 'content'>[] | null) ?? null, error: error?.message ?? null }
    },

    async get(id: string): Promise<StoreResult<DocTemplateRow>> {
      const { data, error } = await client.from(TABLE).select(COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle()
      return { data: (data as DocTemplateRow | null) ?? null, error: error?.message ?? null }
    },

    async create(input: DocTemplateInput): Promise<StoreResult<DocTemplateRow>> {
      const invalid = validateContent(input.content)
      if (invalid) return { data: null, error: invalid }
      if (!input.title.trim()) return { data: null, error: '제목을 입력하세요.' }
      const { data, error } = await client
        .from(TABLE)
        .insert({
          title: input.title.trim(),
          kind: input.kind ?? 'doc',
          content: input.content,
          meta: input.meta ?? {},
          status: input.status ?? 'active',
        })
        .select(COLUMNS)
        .single()
      return { data: (data as DocTemplateRow | null) ?? null, error: error?.message ?? null }
    },

    async update(id: string, patch: DocTemplatePatch): Promise<StoreResult<DocTemplateRow>> {
      if (patch.content !== undefined) {
        const invalid = validateContent(patch.content)
        if (invalid) return { data: null, error: invalid }
      }
      if (patch.title !== undefined && !patch.title.trim()) return { data: null, error: '제목을 입력하세요.' }
      const row: Record<string, unknown> = {}
      if (patch.title !== undefined) row.title = patch.title.trim()
      if (patch.kind !== undefined) row.kind = patch.kind
      if (patch.content !== undefined) row.content = patch.content
      if (patch.meta !== undefined) row.meta = patch.meta
      if (patch.status !== undefined) row.status = patch.status
      if (Object.keys(row).length === 0) return { data: null, error: '변경할 내용이 없습니다.' }
      const { data, error } = await client
        .from(TABLE)
        .update(row)
        .eq('id', id)
        .is('deleted_at', null)
        .select(COLUMNS)
        .single()
      return { data: (data as DocTemplateRow | null) ?? null, error: error?.message ?? null }
    },

    /** 소프트 삭제 */
    async remove(id: string): Promise<StoreResult<{ id: string }>> {
      const { data, error } = await client
        .from(TABLE)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .single()
      return { data: (data as { id: string } | null) ?? null, error: error?.message ?? null }
    },
  }
}

export type DocStore = ReturnType<typeof createDocStore>
