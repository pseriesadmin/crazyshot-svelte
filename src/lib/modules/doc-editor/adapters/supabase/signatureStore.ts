/**
 * signatureStore.ts — 서명/직인 자산 저장소 + 업로더 (Supabase 어댑터, 이식용)
 *
 * toEditorAssets(): DocEditor 의 listSignatureAssets 에 바로 꽂을 수 있는 형태로 변환한다.
 * createStorageUploader(): DocEditor 의 uploadImage 에 꽂을 수 있는 업로더(Supabase Storage 공개 버킷).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignatureAsset } from '../../core/types'
import type { SignatureAssetRow, StoreResult } from './types'

const TABLE = 'doc_signature_assets'
const COLUMNS = 'id,asset_type,label,image_url,storage_path,is_default,created_at,deleted_at'

export function createSignatureStore(client: SupabaseClient) {
  return {
    async list(): Promise<StoreResult<SignatureAssetRow[]>> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .is('deleted_at', null)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
      return { data: (data as SignatureAssetRow[] | null) ?? null, error: error?.message ?? null }
    },

    async create(input: {
      assetType: 'signature' | 'seal'
      imageUrl: string
      storagePath?: string
      label?: string
      isDefault?: boolean
    }): Promise<StoreResult<SignatureAssetRow>> {
      if (!input.imageUrl) return { data: null, error: '이미지 주소가 필요합니다.' }
      const { data, error } = await client
        .from(TABLE)
        .insert({
          asset_type: input.assetType,
          image_url: input.imageUrl,
          storage_path: input.storagePath ?? null,
          label: input.label ?? null,
          is_default: input.isDefault ?? false,
        })
        .select(COLUMNS)
        .single()
      return { data: (data as SignatureAssetRow | null) ?? null, error: error?.message ?? null }
    },

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

export type SignatureStore = ReturnType<typeof createSignatureStore>

/** 저장소 행 → 편집기 자산 형태 */
export function toEditorAssets(rows: SignatureAssetRow[]): SignatureAsset[] {
  return rows.map((r) => ({
    id: r.id,
    assetType: r.asset_type,
    imageUrl: r.image_url,
    name: r.label ?? undefined,
    isDefault: r.is_default,
  }))
}

/**
 * Supabase Storage 업로더 — 편집기의 uploadImage 주입용.
 * 보통 브라우저 클라이언트(anon + 인증 사용자, 버킷 정책 필요) 또는 서버 엔드포인트 경유로 쓴다.
 * 버킷은 sql/001_doc_editor.sql 이 만드는 'doc-editor-assets'(공개 읽기) 기본값.
 */
export function createStorageUploader(
  client: SupabaseClient,
  opts: { bucket?: string; prefix?: string } = {},
): (file: File) => Promise<{ url: string }> {
  const bucket = opts.bucket ?? 'doc-editor-assets'
  const prefix = (opts.prefix ?? 'images').replace(/^\/+|\/+$/g, '')
  return async (file: File) => {
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`
    const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    const { data } = client.storage.from(bucket).getPublicUrl(path)
    return { url: data.publicUrl }
  }
}
