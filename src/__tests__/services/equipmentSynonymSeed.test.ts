// 영상장비 동의어 시드(Migration 837·838) 데이터 불변식 — 잡음 그룹·서로 다른 대상 묶음·중복 대표어 방지 (2026-11-17)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

function parse(file: string): { canon: string; terms: string[] }[] {
  const sql = readFileSync(file, 'utf8')
  const rows: { canon: string; terms: string[] }[] = []
  for (const m of sql.matchAll(/\('((?:[^']|'')*)', ARRAY\[(.*?)\]::text\[\]\)/g)) {
    const terms = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"))
    rows.push({ canon: m[1].replace(/''/g, "'"), terms })
  }
  // 838 압축 형식: ('대표어','표기1|표기2|...')
  for (const m of sql.matchAll(/^\('((?:[^']|'')*)','((?:[^']|'')*)'\),?$/gm)) {
    rows.push({ canon: m[1].replace(/''/g, "'"), terms: m[2].replace(/''/g, "'").split('|') })
  }
  return rows
}

// 839가 지운 표기는 적용 후 실제 상태에서 빠진다 — 불변식은 "837·838 − 839" 기준으로 검사한다
const cleanup839 = [...readFileSync('supabase/migrations/20261118100000_839_seed_synonym_cleanup.sql', 'utf8').matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)].map((m) => `${m[1]}\u0000${m[2]}`)
function applyCleanup(rows: { canon: string; terms: string[] }[]): { canon: string; terms: string[] }[] {
  return rows.map((r) => ({ canon: r.canon, terms: r.terms.filter((t) => !cleanup839.includes(`${r.canon}\u0000${t.toLowerCase()}`)) }))
}
const seed837 = applyCleanup(parse('supabase/migrations/20261117120000_837_brand_synonym_seed.sql'))
const seed838 = applyCleanup(parse('supabase/migrations/20261117130000_838_equipment_terms_seed.sql'))

// 일반어·모호한 약어 — 어떤 시드 그룹에도 구성 표기로 들어가면 안 된다(검색어 확장이 엉뚱한 곳으로 번진다)
const GENERIC = ['zoom', 'light', 'sharp', 'core', 'fluid', 'agent', 'insta', 'mini', 'log', 'rig', 'wide', 'soft', 'moment', 'miller', 'is', 'vr', 'vc', 'pl', 'ff', 'da', 'bt', 'pq', 'dc', 'cf', 'sd', 'tc', 'tx', 'rx', 'wd', 'gear', 'kit', 'event', 'sports', 'rental', 'pan', 'tilt', 'mic', 'look', 'frame', 'red', 'b&w']

describe.each([
  ['837 브랜드 시드', seed837],
  ['838 용어·브랜드 시드', seed838],
])('%s', (_name, rows) => {
  it('그룹이 충분히 들어 있다', () => {
    expect(rows.length).toBeGreaterThan(150)
  })
  it('모든 그룹은 대표어를 포함해 표기 2개 이상', () => {
    for (const r of rows) {
      expect(r.terms.length, r.canon).toBeGreaterThanOrEqual(2)
      expect(r.terms[0], r.canon).toBe(r.canon)
    }
  })
  it('대표어가 중복되지 않는다', () => {
    const canons = rows.map((r) => r.canon)
    expect(new Set(canons).size).toBe(canons.length)
  })
  it('한 그룹 안에서 대소문자만 다른 표기가 중복되지 않는다', () => {
    for (const r of rows) {
      const low = r.terms.map((t) => t.toLowerCase())
      expect(new Set(low).size, r.canon).toBe(low.length)
    }
  })
  it('일반어·모호한 약어가 구성 표기로 들어가지 않는다', () => {
    for (const r of rows) {
      const bad = r.terms.slice(1).filter((t) => GENERIC.includes(t.toLowerCase()))
      expect(bad, r.canon).toEqual([])
    }
  })
})

describe('838 — 서로 다른 대상을 한 그룹으로 묶지 않는다', () => {
  const byCanon = new Map(seed838.map((r) => [r.canon, r.terms.map((t) => t.toLowerCase())]))
  it('코덱·해상도·모델 세대 같은 여러 대상을 묶은 그룹은 없다', () => {
    for (const dropped of ['코덱', '해상도', '색심도', '컬러스페이스', '엔피에프', '알파육천사백', '이오에스알칠', '엑스티포', '지에이치오', '로그촬영', '촬영장비', '렌탈하우스']) {
      expect(byCanon.has(dropped), dropped).toBe(false)
    }
  })
  it('같은 모델의 표기만 묶는다(세대가 다른 모델이 섞이지 않는다)', () => {
    const a7m4 = byCanon.get('알파세븐포') ?? []
    expect(a7m4).toContain('a7m4')
    expect(a7m4).not.toContain('a7m3')
    const zve10 = byCanon.get('제트브이이텐') ?? []
    expect(zve10).not.toContain('zv-e10 ii')
  })
  it('서로 다른 연결 단자·마운트가 한 그룹에 섞이지 않는다', () => {
    expect(byCanon.get('에이치디엠아이') ?? []).not.toContain('micro hdmi')
    expect(byCanon.get('캐논이에프마운트') ?? []).not.toContain('ef-s')
    expect(byCanon.get('에스디카드') ?? []).not.toContain('v90')
  })
  it('같은 말이 두 그룹에 겹치지 않는다(라이트박스·역광 정리)', () => {
    expect(byCanon.get('소프트박스') ?? []).not.toContain('lightbox')
    expect(byCanon.get('백라이트') ?? []).not.toContain('역광')
  })
  it('핵심 한·영 짝이 들어 있다', () => {
    const find = (en: string) => seed838.some((r) => r.terms.some((t) => t.toLowerCase() === en.toLowerCase()))
    for (const en of ['Viewfinder', 'Shotgun Microphone', 'Lavalier Microphone', 'Follow Focus', 'Matte Box', 'ND Filter', 'Gimbal', 'Phantom Power', 'V-mount', 'Timecode']) {
      expect(find(en), en).toBe(true)
    }
  })
})

describe('839 — 잘못 묶인 시드 표기 정정', () => {
  const sql = readFileSync('supabase/migrations/20261118100000_839_seed_synonym_cleanup.sql', 'utf8')
  const pairs = [...sql.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)].map((m) => [m[1], m[2]] as const)
  it('시드(source=seed) 행만 그룹 단위로 지운다', () => {
    expect(sql).toContain("m.source = 'seed'")
    expect(sql).toContain('g.canonical_term = d.canon')
    expect(sql).not.toMatch(/TRUNCATE|DROP /i)
  })
  it('서로 다른 대상으로 지적된 표기가 전부 지정돼 있다', () => {
    const has = (c: string, t: string) => pairs.some(([pc, pt]) => pc === c && pt === t)
    for (const [c, t] of [['이미지센서', 'cmos'], ['뷰파인더', 'evf'], ['초음파모터', 'usm'], ['피엑스더블유제트구십', 'nx80'], ['티펜', 'steadicam'], ['B+W', 'b&w'], ['레드디지털시네마', 'red']]) {
      expect(has(c, t), `${c}:${t}`).toBe(true)
    }
    expect(pairs.length).toBe(32)
  })
  it('지울 표기는 전부 소문자(비교가 lower() 기준)이고 대표어는 시드 파일에 실제로 있다', () => {
    const all = new Set([...parse('supabase/migrations/20261117120000_837_brand_synonym_seed.sql'), ...parse('supabase/migrations/20261117130000_838_equipment_terms_seed.sql')].map((r) => r.canon))
    for (const [c, t] of pairs) {
      expect(t, t).toBe(t.toLowerCase())
      expect(all.has(c), c).toBe(true)
    }
  })
})

describe('837·838 마이그레이션 형식', () => {
  it('멱등 시드이며 기존 행을 덮어쓰지 않는다(ON CONFLICT DO NOTHING)', () => {
    for (const f of ['supabase/migrations/20261117120000_837_brand_synonym_seed.sql', 'supabase/migrations/20261117130000_838_equipment_terms_seed.sql']) {
      const sql = readFileSync(f, 'utf8')
      expect(sql).toContain('ON CONFLICT (group_id, term) DO NOTHING')
      expect(sql).toContain("'seed', 'confirmed'")
      expect(sql).not.toMatch(/DELETE FROM synonym_group_members\s*WHERE[^;]*;\s*DO/)
    }
  })
  it('838은 시드가 아닌 기존 그룹(채팅 학습 등)에는 합치지 않는다', () => {
    const sql = readFileSync('supabase/migrations/20261117130000_838_equipment_terms_seed.sql', 'utf8')
    expect(sql).toContain("m.source = 'seed'")
  })
})
