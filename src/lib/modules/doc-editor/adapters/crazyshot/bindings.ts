/**
 * bindings.ts — 크레이지샷 호스트 바인딩 (adapters/crazyshot)
 *
 * 통합 편집기가 요구하는 주입 지점(notify·listSignatureAssets)을 이 프로젝트의 구현에 연결한다.
 * 이미지 업로드는 기존 계약서 편집기와 동일하게 data URL 인라인(uploadImage 미주입)을 유지한다.
 */
import { csToast } from '$lib/utils/toast'
import type { SignatureAsset } from '../../core/types'

export function notify(message: string, level: 'warning' | 'error' | 'info'): void {
  if (level === 'error') csToast.error(message)
  else if (level === 'warning') csToast.warning(message)
  else csToast.info(message)
}

interface SignatureAssetRow {
  id: string
  asset_type: string
  image_url: string
  label: string | null
  is_default: boolean
}

/** GET /api/cms/signature-assets → SignatureAsset[] (실패 시 빈 목록) */
export async function listSignatureAssets(): Promise<SignatureAsset[]> {
  try {
    const res = await fetch('/api/cms/signature-assets')
    if (!res.ok) return []
    const rows = (await res.json()) as SignatureAssetRow[]
    return rows.map((r) => ({
      id: r.id,
      assetType: r.asset_type,
      imageUrl: r.image_url,
      name: r.label ?? undefined,
      isDefault: r.is_default,
    }))
  } catch {
    return []
  }
}
