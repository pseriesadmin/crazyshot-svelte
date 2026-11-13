// 장바구니 "예약신청" 제출을 막는 가장 먼저 빠진 항목 안내 문구 (2026-10-05)
// 이전에는 어떤 항목이 빠져도 "미입력 항목을 확인하세요" 한 문구였다 — 고객이 수령일만 고르고 달력이 닫힌 경우처럼
// 무엇이 빠졌는지 알 수 없어 이탈하던 문제를 줄이기 위해, 화면 위에서 아래 순서대로 첫 번째 빠진 항목을 알려 준다.
// 순서는 화면 위→아래(수령 아코디언 전체 → 반납 아코디언 전체 → 마감·요금·약관)이며 안내 문구와 이동 위치(아래 Target)가 같은 목록에서 나온다.
// 판정 기준은 cart/+page.svelte의 readyToSubmit 구성요소(datesSet·pickupPointsSet·formsComplete·methodSelectionValid·
// deadlineOk·priceUnsetBlocked·agreed)와 같다 — 제출 게이트를 바꾸면 이 함수의 입력도 함께 갱신해야 한다.

export interface CartSubmitBlockerInput {
  hasItems: boolean
  methodInvalid: boolean
  rentalDateMissing: boolean
  rentalTimeMissing: boolean
  returnDateMissing: boolean
  returnTimeMissing: boolean
  rentalPointMissing: boolean
  returnPointMissing: boolean
  /** 수령 정보 폼에서 비어 있는 항목 라벨(순서 고정) */
  rentalFormMissing: string[]
  /** 반납 정보 폼에서 비어 있는 항목 라벨 */
  returnFormMissing: string[]
  deadlineOk: boolean
  priceUnset: boolean
  agreed: boolean
  /** 방법 미선택(methodInvalid)일 때 어느 쪽 아코디언을 가리킬지 — 수령 방법이 비었으면 'rental', 아니면 'return_'. 생략하면 'rental'. */
  methodLeg?: CartBlockerLeg
}

export type CartBlockerLeg = 'rental' | 'return_'
export type CartBlockerPart = 'method' | 'date' | 'time' | 'point' | 'name' | 'email' | 'phone' | 'addr' | 'addrDetail'
export interface CartBlockerTarget {
  leg: CartBlockerLeg
  part: CartBlockerPart
}

interface BlockerStep {
  message: string
  /** 대여예약옵션 영역 밖(상품 선택·요금·약관)이면 null */
  target: CartBlockerTarget | null
}

const CUSTOMER_LABELS: Array<[string, CartBlockerPart]> = [['이름', 'name'], ['전자메일', 'email'], ['휴대번호', 'phone']]
const ADDRESS_LABELS: Array<[string, CartBlockerPart]> = [['기본주소', 'addr'], ['상세주소', 'addrDetail']]

function firstPart(missing: string[], group: Array<[string, CartBlockerPart]>): CartBlockerPart | null {
  for (const [label, part] of group) if (missing.includes(label)) return part
  return null
}


/** 받침 유무에 따라 을/를 */
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  if (last < 0xac00 || last > 0xd7a3) return '을'
  return (last - 0xac00) % 28 === 0 ? '를' : '을'
}

function formMissingMessage(word: string, missing: string[]): string {
  const labels: string[] = []
  let addressAdded = false
  for (const label of missing) {
    if (label === '기본주소' || label === '상세주소') {
      if (!addressAdded) { labels.push('주소'); addressAdded = true }
    } else {
      labels.push(label)
    }
  }
  if (labels.length === 0) return ''
  if (labels.length >= 3) return `${word} 정보를 입력해주세요.`
  const joined = labels.join(', ')
  return `${word} ${joined}${objectParticle(labels[labels.length - 1])} 입력해주세요.`
}

/** 한 쪽(수령 또는 반납) 아코디언 안의 빠진 항목을 화면 위→아래 순서로 나열한다. */
function legSteps(i: CartSubmitBlockerInput, leg: CartBlockerLeg): BlockerStep[] {
  const isRental = leg === 'rental'
  const word = isRental ? '수령' : '반납'
  const methodLeg = i.methodLeg ?? 'rental'
  const date = isRental ? i.rentalDateMissing : i.returnDateMissing
  const time = isRental ? i.rentalTimeMissing : i.returnTimeMissing
  const point = isRental ? i.rentalPointMissing : i.returnPointMissing
  const form = isRental ? i.rentalFormMissing : i.returnFormMissing
  const out: BlockerStep[] = []
  if (i.methodInvalid && methodLeg === leg) out.push({ message: '수령·반납 방법을 선택해주세요.', target: { leg, part: 'method' } })
  if (date) out.push({ message: `${word}일을 선택해주세요.`, target: { leg, part: 'date' } })
  if (time) out.push({ message: `${word} 시간을 선택해주세요.`, target: { leg, part: 'time' } })
  // 토스트가 길어 보이던 문제(2026-11-13): 기본주소·상세주소는 '주소' 하나로 합쳐 부르고, 합친 빠진 항목이 3개 이상이면 '정보'로 줄인다.
  //   예) '수령 주소를 입력해주세요.' / '수령 이름, 휴대번호를 입력해주세요.' / '수령 정보를 입력해주세요.'
  const formMessage = formMissingMessage(word, form)
  // 화면 순서: 고객 정보 → 방문지점 → 주소
  const customerPart = firstPart(form, CUSTOMER_LABELS)
  if (customerPart) out.push({ message: formMessage, target: { leg, part: customerPart } })
  if (point) out.push({ message: `${word} 방문지점을 선택해주세요.`, target: { leg, part: 'point' } })
  const addressPart = firstPart(form, ADDRESS_LABELS)
  if (addressPart) out.push({ message: formMessage, target: { leg, part: addressPart } })
  return out
}

function orderedSteps(i: CartSubmitBlockerInput): BlockerStep[] {
  if (!i.hasItems) return [{ message: '예약할 상품을 선택해주세요.', target: null }]
  const steps: BlockerStep[] = [...legSteps(i, 'rental'), ...legSteps(i, 'return_')]
  if (!i.deadlineOk) steps.push({ message: '선택한 수령일의 신청 마감 시각이 지났어요. 수령일을 다시 선택해주세요.', target: { leg: 'rental', part: 'date' } })
  if (i.priceUnset) steps.push({ message: '요금이 정해지지 않은 상품은 예약할 수 없어요. 해당 상품의 체크를 해제해주세요.', target: null })
  if (!i.agreed) steps.push({ message: '이용 약관에 동의해주세요.', target: null })
  return steps
}

/** 가장 먼저 빠진 항목의 안내 문구. 막는 항목이 없으면 null. */
export function firstCartSubmitBlocker(i: CartSubmitBlockerInput): string | null {
  return orderedSteps(i)[0]?.message ?? null
}

/** 가장 먼저 빠진 항목의 이동 대상(안내 문구와 같은 항목). 영역 밖 항목이거나 막는 항목이 없으면 null. */
export function firstCartSubmitBlockerTarget(i: CartSubmitBlockerInput): CartBlockerTarget | null {
  return orderedSteps(i)[0]?.target ?? null
}
