/**
 * contractCatalog.ts — 크레이지샷 계약서 변수 카탈로그 (adapters/crazyshot)
 *
 * 변수 키는 ContractSubstitutionData(contract-module.ts)의 키와 같아야 한다(치환 엔진이 같은 키로 값을 찾는다).
 * 기존 ContractFieldPanel의 계약자·상품·결제 18개는 키·표기 순서를 그대로 유지하고,
 * 타입에는 있었지만 패널에 노출되지 않던 변수(일정·지점·임대인 등)를 뒤에 추가로 노출한다.
 */
import type { VariableCatalog } from '../../core/types'

export const CONTRACT_VARIABLE_CATALOG: VariableCatalog = [
  {
    key: 'customer',
    label: '계약자',
    items: [
      { variable: '고객이름', label: '고객이름' },
      { variable: '연락처', label: '연락처' },
      { variable: '이메일', label: '이메일' },
      { variable: '주소', label: '주소' },
    ],
  },
  {
    key: 'product',
    label: '상품',
    items: [
      { variable: '예약코드', label: '예약코드' },
      { variable: '상품코드', label: '상품코드' },
      { variable: '상품명', label: '상품명' },
      { variable: '수량', label: '수량 (실제 예약 건수)' },
      { variable: '수령형태', label: '수령형태' },
      { variable: '수령일시', label: '수령일시' },
      { variable: '반납형태', label: '반납형태' },
      { variable: '반납일시', label: '반납일시' },
      { variable: '요금유형', label: '요금유형' },
      { variable: '구성품', label: '구성품' },
      // 아래는 기존 패널에 없던 변수(2026-10-14 추가 노출)
      { variable: '수령일자', label: '수령일자' },
      { variable: '반납일자', label: '반납일자' },
      { variable: '대여일수', label: '대여일수' },
      { variable: '총사용시간', label: '총사용시간' },
      { variable: '수령방법지점', label: '수령방법(지점)' },
      { variable: '반납방법지점', label: '반납방법(지점)' },
      { variable: '지점옵션', label: '지점옵션' },
    ],
  },
  {
    key: 'payment',
    label: '결제',
    items: [
      { variable: '기본대여요금', label: '기본대여요금' },
      { variable: '할인금액', label: '할인금액 (등급할인)' },
      { variable: '할인차감', label: '할인차감 (쿠폰)' },
      { variable: '차감포인트', label: '차감포인트' },
      { variable: '배송비', label: '배송비' },
      { variable: '부가세', label: '부가세' },
      { variable: '최종합계', label: '최종합계' },
      // 기존 패널에 없던 변수
      { variable: '총 정상 대여가', label: '총 정상 대여가' },
      { variable: '할인반영금액', label: '할인반영금액' },
    ],
  },
  {
    key: 'etc',
    label: '기타',
    items: [
      { variable: '계약서발행일', label: '계약서발행일' },
      { variable: '임대인상호명', label: '임대인 상호명' },
      { variable: '임대인대표자명', label: '임대인 대표자명' },
      { variable: '임대인사업자번호', label: '임대인 사업자번호' },
      { variable: '임대인사업장주소', label: '임대인 사업장주소' },
    ],
  },
]
