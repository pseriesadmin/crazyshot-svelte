import { describe, it, expect } from 'vitest'
import { parseCsv, groupByPhone, detectLegacySource } from '$lib/server/legacyCsvImport'

/**
 * 레거시 회원 CSV 파서 — 원본(39열) 내보내기 파일을 그대로 읽는다 (2026-10-29, 1단계)
 * 예전에는 6열(이름·전화·이메일·가입일·구매횟수·출처)을 앞에서부터 읽어서, 원본을 사람이 가공하는 중에
 * 구매금액·관리자 메모·가입 방식이 빠졌다. 이제 머리글 이름으로 항목을 찾고, 따옴표 안 줄바꿈(여러 줄 메모)도 읽는다.
 */
const HEADER = '언어,고유키,이메일,아이디,회원 그룹,회원 등급,이름,연락처,생년월일,가입일,구매횟수(KRW),구매금액(KRW),보유 적립금,NAVER ID,KAKAO ID,GOOGLE ID,관리자 메모'

const STAFF = 'KR,k0,admin@ex.co.kr,admin@ex.co.kr,"관리그룹, 업체 서비스관리",기본등급,관리자,  ,0000-00-00,2026-01-07 19:35:05,0,0,0,,,106433698,'
const KAKAO = 'KR,k1,kim@naver.com,kim@naver.com,일반회원,기본등급,김고객, 01012345678 ,0000-00-00,2026-04-11 19:13:29,2,"55,963",54,,4841543851,,"2026-04-11  20:44:06 / linkBnX5Jm3IqVg\n\n2026-04-12  23:05:10/ linkBnYPxHQ4aur"'
const GOOGLE = 'KR,k2,lee@gmail.com,lee@gmail.com,,기본등급,이구글,01022223333,1990-05-17,2026-05-07 17:58:46,0,0,0,,,106813711,"미성년자 고객, ""첫 주문"" 문의 후 취소"'
const NAVER = 'KR,k3,park@naver.com,park@naver.com,,기본등급,박네이버,01033334444,0000-00-00,2026-06-02 11:57:55,1,21000,38,k0t9TDeURx,,,'
const PLAIN = 'KR,k4,plain@daum.net,plain@daum.net,,기본등급,김이메일, 010-4904-6589 ,0000-00-00,2026-08-25 17:18:58,1,42000,300,,,,'

const sample = [HEADER, STAFF, KAKAO, GOOGLE, NAVER, PLAIN].join('\n')

describe('parseCsv — 원본 내보내기(머리글) 형식', () => {
  const rows = parseCsv(sample)
  const by = (email: string) => rows.find((r) => r.email === email)!

  it('모든 행을 읽는다(여러 줄 메모가 행을 쪼개지 않는다)', () => {
    expect(rows).toHaveLength(5)
  })

  it('이름·연락처·이메일·가입일·구매횟수는 머리글 이름으로 찾는다(열 순서에 의존하지 않음)', () => {
    const r = by('kim@naver.com')
    expect(r.name).toBe('김고객')
    expect(r.phone).toBe('01012345678')
    expect(r.signupAt).toBe('2026-04-11 19:13:29')
    expect(r.purchaseCount).toBe(2)
  })

  it('연락처의 앞뒤 공백·하이픈은 정리한다', () => {
    expect(by('plain@daum.net').phone).toBe('01049046589')
  })

  it('구매금액은 콤마가 있어도 숫자로 읽는다', () => {
    expect(by('kim@naver.com').purchaseAmount).toBe(55963)
    expect(by('park@naver.com').purchaseAmount).toBe(21000)
    expect(by('lee@gmail.com').purchaseAmount).toBe(0)
  })

  it('관리자 메모는 줄바꿈·따옴표를 보존해 그대로 읽고, 비어 있으면 null', () => {
    expect(by('kim@naver.com').memo).toBe('2026-04-11  20:44:06 / linkBnX5Jm3IqVg\n\n2026-04-12  23:05:10/ linkBnYPxHQ4aur')
    expect(by('lee@gmail.com').memo).toBe('미성년자 고객, "첫 주문" 문의 후 취소')
    expect(by('park@naver.com').memo).toBeNull()
  })

  it('가입 방식: 카카오·네이버·구글 연동 ID 로 판정하고, 없으면 이메일', () => {
    expect(by('kim@naver.com').source).toBe('kakao')
    expect(by('park@naver.com').source).toBe('naver')
    expect(by('lee@gmail.com').source).toBe('google')
    expect(by('plain@daum.net').source).toBe('email')
  })

  it('생년월일: 0000-00-00 은 비움, 실제 날짜는 보존', () => {
    expect(by('kim@naver.com').birthDate).toBeNull()
    expect(by('lee@gmail.com').birthDate).toBe('1990-05-17')
  })

  it('운영진(회원 그룹 "관리그룹")은 표시한다', () => {
    expect(by('admin@ex.co.kr').isStaff).toBe(true)
    expect(by('kim@naver.com').isStaff).toBe(false)
  })

  it('연락처가 비어 있으면 null', () => {
    expect(by('admin@ex.co.kr').phone).toBeNull()
  })

  it('존재하지 않는 생년월일(1990-02-31)은 비운다', () => {
    const r = parseCsv([HEADER, 'KR,k9,x@ex.com,x@ex.com,,기본등급,엑스,01099998888,1990-02-31,2026-01-01 00:00:00,0,0,0,,,,'].join('\n'))
    expect(r[0].birthDate).toBeNull()
  })
})

describe('parseCsv — 예전 6열 형식은 그대로 읽는다(회귀 방지)', () => {
  it('머리글 없는 6열(이름, 전화, 이메일, 가입일, 구매횟수, 출처)', () => {
    const rows = parseCsv('홍길동,010-1111-2222,hong@ex.com,2026-01-02,3,kakao\n김철수,01033334444,kim@ex.com,,0,')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: '홍길동', phone: '01011112222', email: 'hong@ex.com', signupAt: '2026-01-02', purchaseCount: 3, source: 'kakao', purchaseAmount: 0, memo: null, isStaff: false })
    expect(rows[1].source).toBe('csv')
  })

  it('이름·전화·이메일… 머리글이 있는 6열', () => {
    const rows = parseCsv('이름,전화,이메일,가입일,구매횟수,출처\n홍길동,01011112222,hong@ex.com,2026-01-02,3,naver')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '홍길동', phone: '01011112222', email: 'hong@ex.com', purchaseCount: 3, source: 'naver' })
  })

  it('탭 구분도 읽는다', () => {
    const rows = parseCsv('홍길동\t01011112222\thong@ex.com\t2026-01-02\t1\tcsv')
    expect(rows[0].email).toBe('hong@ex.com')
  })

  it('빈 입력은 빈 목록', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})

describe('detectLegacySource', () => {
  it('우선순위: 카카오 > 네이버 > 구글 > 애플 > 페이스북 > 라인, 없으면 이메일', () => {
    expect(detectLegacySource({ kakao: 'k', naver: 'n', google: 'g' })).toBe('kakao')
    expect(detectLegacySource({ naver: 'n', google: 'g' })).toBe('naver')
    expect(detectLegacySource({ google: 'g' })).toBe('google')
    expect(detectLegacySource({ apple: 'a' })).toBe('apple')
    expect(detectLegacySource({ facebook: 'f' })).toBe('facebook')
    expect(detectLegacySource({ line: 'l' })).toBe('line')
    expect(detectLegacySource({})).toBe('email')
  })
})

describe('groupByPhone — 구매금액·메모 합산과 운영진 자동 제외', () => {
  const rows = parseCsv(sample)
  const groups = groupByPhone(rows)

  it('운영진 행만 있는 묶음은 기본으로 제외 표시된다', () => {
    const g = groups.find((x) => x.rows[0].email === 'admin@ex.co.kr')!
    expect(g.excluded).toBe(true)
    expect(g.staff).toBe(true)
  })

  it('일반 고객 묶음은 제외되지 않는다', () => {
    const g = groups.find((x) => x.rows[0].email === 'kim@naver.com')!
    expect(g.excluded).toBe(false)
    expect(g.staff).toBe(false)
    expect(g.totalPurchaseAmount).toBe(55963)
    expect(g.memo).toContain('linkBnX5Jm3IqVg')
  })

  it('같은 전화번호 여러 행은 구매횟수·구매금액을 합산하고 메모를 모두 이어 붙인다', () => {
    const two = parseCsv([
      HEADER,
      'KR,a,one@ex.com,one@ex.com,,기본등급,김하나,01055556666,0000-00-00,2026-03-01 10:00:00,1,10000,0,,,,메모A',
      'KR,b,two@ex.com,two@ex.com,,기본등급,김하나,01055556666,0000-00-00,2026-03-02 11:00:00,2,20000,0,,,,메모B',
    ].join('\n'))
    const g = groupByPhone(two)[0]
    expect(g.rows).toHaveLength(2)
    expect(g.totalPurchaseCount).toBe(3)
    expect(g.totalPurchaseAmount).toBe(30000)
    expect(g.memo).toBe('메모A\n메모B')
  })

  it('운영진과 일반 고객이 섞인 묶음은 제외하지 않는다', () => {
    const mixed = parseCsv([
      HEADER,
      'KR,a,staff@ex.com,staff@ex.com,"관리그룹, 업체 서비스관리",기본등급,김하나,01055556666,0000-00-00,2026-03-01 10:00:00,0,0,0,,,,',
      'KR,b,cust@ex.com,cust@ex.com,,기본등급,김하나,01055556666,0000-00-00,2026-03-02 11:00:00,1,5000,0,,,,',
    ].join('\n'))
    expect(groupByPhone(mixed)[0].excluded).toBe(false)
  })
})

describe('parseCsv — 방어 보강 (sp3 검수 반영)', () => {
  it('이름 열만 있고 이메일·연락처 열이 없는 머리글은 어긋나게 읽지 않고 빈 결과를 돌려준다', () => {
    expect(parseCsv('이름,메모\n홍길동,메모내용')).toEqual([])
  })

  it('파일 맨 앞의 BOM(\\uFEFF)은 무시한다', () => {
    const rows = parseCsv('\uFEFF' + [HEADER, KAKAO].join('\n'))
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('kim@naver.com')
  })

  it('소셜 ID 칸이 "0"·"-"·"null" 같은 빈 표시면 연동으로 보지 않는다', () => {
    const rows = parseCsv([HEADER, 'KR,k7,fake@ex.com,fake@ex.com,,기본등급,가짜,01077778888,0000-00-00,2026-01-01 00:00:00,0,0,0,-,0,null,'].join('\n'))
    expect(rows[0].source).toBe('email')
  })
})
