// offhours.ts — "영업시간 외(새벽·야간) 질문" 예상 질문 조합 구조 + 키워드 도출 (순수 데이터·함수, 결정적 — 난수 없음)
//
// 목적: 영업시간(09:00~22:00) 밖의 대여·수령·반납·상담 질문이 빠른답변 키워드와 어긋나 대기 안내로 새던 문제를
//       "시간 표현 × 행동 × 장소" 조합으로 예상 질문을 만들고, 그 조합에서 키워드를 뽑아 FAQ에 매핑하는 구조로 정리한다.
// 사용: scripts/canned-match/README 또는 nlsearch.md §3-4 참고. 평가는 임시 vitest 프로브(매처는 $lib 별칭이 필요)에서 이 모듈을 import한다.
// 주의: 문구는 모두 일반적인 패턴을 새로 만든 것이다 — 실제 고객 질문은 사용하지 않는다(synthetic.ts와 같은 원칙).

export type OffHoursIntent = 'pickup' | 'return' | 'place' | 'hours' | 'reserve_pay'

export interface PredictedQuestion {
  text: string
  intent: OffHoursIntent
  /** 시간 표현 종류: word(새벽 등 단어) / clock(숫자 시각) / none(시간 표현 없음) */
  timeKind: 'word' | 'clock' | 'none'
}

/** 영업시간(09:00~22:00) 밖을 뜻하는 단어형 표현. 조사("에")를 붙인 모양으로 둔다 — 매처가 조사를 떼므로 어근이 키워드가 된다. */
export const OFF_HOURS_WORDS = [
  '새벽에', '심야에', '한밤중에', '밤늦게', '밤에', '늦은 밤에', '늦은 시간에', '자정에', '야간에',
  '영업시간 외에', '영업시간 이후에', '영업 끝난 뒤에', '이른 아침에', '아침 일찍', '주말 밤에',
] as const

/** 숫자 시각 표현 — 영업 외(08:59 이전·22:00 이후)와 영업 중(대조군)을 함께 둔다. 판정은 offHoursTime.ts. */
export const CLOCK_OFF = ['새벽 3시에', '새벽 5시에', '밤 11시에', '오후 11시에', '오후 10시에', '오후 10시 30분에', '23시에', '24시에', '0시에', '오전 7시에', '오전 8시에', '22:30에', '07:00에'] as const
export const CLOCK_ON = ['오전 9시에', '오전 10시에', '오후 2시에', '오후 6시에', '오후 9시에', '21:30에', '14:00에'] as const

/** 행동 표현 — 의도별. 어미는 "가능해요?"류로 다양화한다. */
export const ACTIONS: Record<OffHoursIntent, readonly string[]> = {
  pickup: ['대여도 가능해요?', '대여할 수 있나요?', '대여 되나요?', '수령 가능한가요?', '장비 받을 수 있나요?', '픽업 가능해요?', '픽업할 수 있나요?', '빌릴 수 있나요?', '매장 가도 되나요?'],
  return: ['반납해도 되나요?', '반납 가능한가요?', '반납할 수 있나요?', '장비 돌려줘도 되나요?'],
  place: ['무인함 이용 가능해요?', '무인보관함 사용할 수 있나요?', '무인보관함으로 반납 가능한가요?', '보관함에서 받을 수 있나요?'],
  hours: ['상담 가능한가요?', '문의해도 되나요?', '연락 되나요?', '채팅 답변 받을 수 있나요?', '영업하나요?'],
  reserve_pay: ['예약 가능해요?', '결제 가능해요?', '예약해도 되나요?'],
}

/** 시간 표현 없이도 영업시간 FAQ가 답해야 하는 질문(공식 영업시간 조회) */
export const PLAIN_HOURS_QUESTIONS = [
  '영업시간이 어떻게 되나요', '운영시간 알려주세요', '몇 시까지 영업해요', '몇시까지 상담 가능해요', '몇 시부터 가능한가요', '상담 시간이 언제예요', '언제까지 문의할 수 있나요', '오픈 시간이 몇 시예요',
] as const

/** 시간 표현 없는 장소 질문(무인함 일반 문의) */
export const PLAIN_PLACE_QUESTIONS = [
  '무인보관함이 뭐예요', '무인함 이용 방법 알려주세요', '무인보관함 비밀번호는 언제 오나요', '보관함 번호는 어떻게 받나요',
] as const

export function generateQuestions(): PredictedQuestion[] {
  const out: PredictedQuestion[] = []
  for (const intent of Object.keys(ACTIONS) as OffHoursIntent[]) {
    for (const t of OFF_HOURS_WORDS) for (const a of ACTIONS[intent]) out.push({ text: `${t} ${a}`, intent, timeKind: 'word' })
    for (const t of CLOCK_OFF) for (const a of ACTIONS[intent]) out.push({ text: `${t} ${a}`, intent, timeKind: 'clock' })
  }
  for (const q of PLAIN_HOURS_QUESTIONS) out.push({ text: q, intent: 'hours', timeKind: 'none' })
  for (const q of PLAIN_PLACE_QUESTIONS) out.push({ text: q, intent: 'place', timeKind: 'none' })
  return out
}

/** 영업 중 시각 대조군 — "영업 외"로 잘못 판정되면 안 되는 질문 */
export function generateInHoursControls(): string[] {
  const out: string[] = []
  for (const t of CLOCK_ON) for (const a of [...ACTIONS.pickup.slice(0, 3), ...ACTIONS.return.slice(0, 2)]) out.push(`${t} ${a}`)
  return out
}

/** 조합 구조에서 도출한 키워드 뿌리 — 조사 제거 후의 어근. FAQ 키워드는 이 뿌리를 쓴다(공백 포함 문구는 쓰지 않는다: 매처가 단어 단위로 비교). */
export function deriveOffHoursRoots(): { time: string[]; place: string[]; marker: string } {
  const time = new Set<string>()
  for (const t of OFF_HOURS_WORDS) {
    const root = t.replace(/\s/g, '').replace(/(에|께|도|이후에|뒤에|일찍)$/, '')
    if (root.length >= 2) time.add(root)
  }
  return { time: [...time], place: ['무인함', '무인보관함', '보관함'], marker: '영업외시간대' }
}

/** 키워드 조합 구조: 시간 어근 × 행동 어근 → "새벽에대여"·"새벽대여" 같은 붙여 쓴 복합 키워드(조사 "에" 유무 두 형태).
 *  매처는 질문 단어(조사 제거 전 3자 이상)가 키워드에 포함될 때도 적중으로 보므로, "새벽에"가 "새벽에대여" 키워드에 걸린다. 공백이 든 키워드는 쓰지 않는다. */
export const COMPOUND_TIME_ROOTS = ['새벽', '심야', '한밤중', '밤늦게', '자정', '늦은시간', '야간', '영업시간외'] as const
export const COMPOUND_ACTION_ROOTS = ['대여', '수령', '픽업', '반납', '방문', '상담', '문의', '연락', '이용', '영업'] as const

export function deriveCompoundKeywords(): string[] {
  const out = new Set<string>()
  for (const t of COMPOUND_TIME_ROOTS) {
    for (const a of COMPOUND_ACTION_ROOTS) {
      out.add(`${t}${a}`)
      out.add(`${t}에${a}`)
    }
  }
  return [...out]
}
