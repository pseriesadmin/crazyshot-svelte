// manualFileFinalize.ts — 상품설명서(PDF) 임시 파일의 소유 확인 · 등록 직후 이관 (서버 전용)
// 배경: 상품 등록 화면에서 올린 PDF는 temp/{등록임시id}/ 에 있다. 이 경로가 등록 후에도 남으면 "임시 파일 삭제" API가
//       실제 상품의 파일을 지우거나, 다른 상품 등록이 같은 파일을 끌어다 쓰는 일이 가능했다(sp3 검수 M1).
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRODUCT_MANUAL_BUCKET, type ProductManualFile } from '$lib/utils/productManuals'

/** 어떤 상품이든 manual_files 에 이 경로를 갖고 있는가. 조회 실패는 null(호출부가 거절 쪽으로 처리) */
export async function manualPathInUse(admin: SupabaseClient, path: string): Promise<boolean | null> {
  const { data, error } = await admin.from('products').select('id').contains('manual_files', [{ path }]).limit(1)
  if (error) return null
  return Array.isArray(data) && data.length > 0
}

/**
 * 등록 직후: temp/ 경로 파일을 {상품id}/{같은 uuid}.pdf 로 옮긴다. 옮기기에 실패한 파일은 temp 경로를 그대로 둔다(등록을 실패시키지 않음).
 * changed=true 면 호출부가 products.manual_files 를 새 목록으로 갱신한다.
 */
export async function adoptTempManualFiles(
  admin: SupabaseClient,
  productId: string,
  files: ProductManualFile[],
): Promise<{ files: ProductManualFile[]; changed: boolean; moved: Array<{ from: string; to: string }> }> {
  let changed = false
  const out: ProductManualFile[] = []
  const moved: Array<{ from: string; to: string }> = []
  for (const f of files) {
    if (!f.path.startsWith('temp/')) { out.push(f); continue }
    const fileName = f.path.split('/').pop() ?? ''
    const to = `${productId}/${fileName}`
    try {
      const { error } = await admin.storage.from(PRODUCT_MANUAL_BUCKET).move(f.path, to)
      if (error) { out.push(f); continue }
      out.push({ ...f, path: to })
      moved.push({ from: f.path, to })
      changed = true
    } catch {
      out.push(f)
    }
  }
  return { files: out, changed, moved }
}

/**
 * 이관 결과를 상품에 저장한다. 저장이 실패하면 한 번 더 시도하고, 그래도 실패하면 옮긴 파일을 임시 위치로 되돌려
 * 상품에 남아 있는(옛 임시 경로) 링크가 가리키는 파일이 그대로 있게 한다 — 이관만 되고 저장이 안 되면 링크가 깨지기 때문(sp3 MINOR-5).
 * 되돌리기 실패는 예외 없이 무시한다(등록 자체는 이미 끝남). 반환: 저장 성공 여부(false 면 호출부가 경고 표시).
 */
export async function persistAdoptedManualFiles(
  admin: SupabaseClient,
  productId: string,
  adopted: { files: ProductManualFile[]; changed: boolean; moved: Array<{ from: string; to: string }> },
): Promise<boolean> {
  if (!adopted.changed) return true
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.from('products').update({ manual_files: adopted.files }).eq('id', productId)
    if (!error) return true
  }
  for (const m of adopted.moved) {
    try {
      await admin.storage.from(PRODUCT_MANUAL_BUCKET).move(m.to, m.from)
    } catch {
      /* 되돌리기 실패는 무시 — 파일은 상품 폴더에 남고 임시 경로 링크만 깨질 수 있어 경고로 알린다 */
    }
  }
  return false
}
