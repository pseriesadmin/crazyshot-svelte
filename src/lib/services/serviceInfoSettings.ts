import type { SupabaseClient } from '@supabase/supabase-js'

// '서비스 기본 정보'(사업자 정보 9개 필드) 공유 조회 유틸 — Migration #566.
// PC 공통푸터·모바일 멤버십 푸터·표준계약서 임대인 정보 3곳이 이 함수 하나로 동일한
// 값을 읽는다(단일 소스). get_service_info_settings()는 공개 RPC(anon 포함)라 로그인
// 여부와 무관하게 어디서든 호출 가능.
export interface ServiceInfoSettings {
  company_name: string
  ceo_name: string
  biz_address: string
  biz_reg_no: string
  mail_order_biz_no: string
  privacy_officer: string
  ceo_email: string
  cs_phone: string
  business_hours: string
}

export const EMPTY_SERVICE_INFO: ServiceInfoSettings = {
  company_name: '',
  ceo_name: '',
  biz_address: '',
  biz_reg_no: '',
  mail_order_biz_no: '',
  privacy_officer: '',
  ceo_email: '',
  cs_phone: '',
  business_hours: '',
}

/**
 * RPC 호출 실패(네트워크 오류 등) 시에도 절대 throw하지 않고 빈 값 객체를 반환한다 —
 * 푸터·계약서 렌더링을 막으면 안 되는 비필수 보조 정보이기 때문.
 */
export async function getServiceInfoSettings(
  supabase: Pick<SupabaseClient, 'rpc'>,
): Promise<ServiceInfoSettings> {
  try {
    const { data, error } = await supabase.rpc('get_service_info_settings')
    if (error || !data) return EMPTY_SERVICE_INFO
    return { ...EMPTY_SERVICE_INFO, ...(data as Partial<ServiceInfoSettings>) }
  } catch {
    return EMPTY_SERVICE_INFO
  }
}
