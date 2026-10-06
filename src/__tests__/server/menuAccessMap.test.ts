/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 디렉터리를 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MENU_ACCESS_PHASE1_KEYS,
  MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS,
  MENU_GUARDED_ENDPOINTS,
  MENU_GUARDED_SHARED_ENDPOINTS,
  MENU_GUARDED_ACTION_FILES,
  MENU_GUARDED_LOADER_FILES,
  isKnownMenuKey,
} from '$lib/server/menuAccessMap'

/** 메뉴 권한 서버 집행 매핑표 정합 + 고객용 엔드포인트 게이트 금지 소스 스캔 (1단계 1a, 2026-10-03) */

const ROOT = process.cwd()

function collectServerFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectServerFiles(p))
    else if (name === '+server.ts') out.push(p)
  }
  return out
}

describe('menuAccessMap — 매핑표 정합', () => {
  it('1단계 대상 키 7개가 모두 CMS_MENUS에 실존한다', () => {
    expect(MENU_ACCESS_PHASE1_KEYS.length).toBe(7)
    for (const k of MENU_ACCESS_PHASE1_KEYS) expect(isKnownMenuKey(k), k).toBe(true)
  })

  it('존재하지 않는 키는 알 수 없는 키로 판정', () => {
    expect(isKnownMenuKey('no.such.menu')).toBe(false)
  })

  it('MENU_GUARDED_ENDPOINTS의 키는 실존 메뉴 키이고 디렉터리는 실존하며 금지 목록과 겹치지 않는다', () => {
    for (const [key, v] of Object.entries(MENU_GUARDED_ENDPOINTS)) {
      expect(isKnownMenuKey(key), key).toBe(true)
      for (const d of v.dirs) {
        expect(existsSync(join(ROOT, d)), d).toBe(true)
        expect(MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS.some((f) => d === f || d.startsWith(`${f}/`)), `${d} 가 금지 목록과 겹침`).toBe(false)
      }
    }
  })
})

describe('고객용·겸용 엔드포인트 게이트 금지 (소스 스캔)', () => {
  it('금지 목록의 디렉터리가 모두 실존한다', () => {
    for (const d of MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS) expect(existsSync(join(ROOT, d)), d).toBe(true)
  })

  it('금지 디렉터리 아래 +server.ts 어디에도 requireMenuAccess가 없다', () => {
    let scanned = 0
    for (const d of MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS) {
      for (const f of collectServerFiles(join(ROOT, d))) {
        scanned++
        expect(readFileSync(f, 'utf-8').includes('requireMenuAccess'), `${f} 에 requireMenuAccess 사용 — 고객용 경로 게이트 금지`).toBe(false)
      }
    }
    expect(scanned).toBeGreaterThan(0)
  })
})

describe('누락 감지 — 매핑표에 올라온 엔드포인트는 반드시 게이트를 가진다 (1b~)', () => {
  const directServerFile = (dir: string) => join(ROOT, dir, '+server.ts')

  it('MENU_GUARDED_ENDPOINTS: 각 디렉터리의 +server.ts가 해당 메뉴 키로 requireMenuAccessApi를 호출', () => {
    let checked = 0
    for (const [key, v] of Object.entries(MENU_GUARDED_ENDPOINTS)) {
      for (const d of v.dirs) {
        const src = readFileSync(directServerFile(d), 'utf-8')
        expect(src.includes(`requireMenuAccessApi(locals, '${key}')`), `${d} 에 ${key} 게이트 없음`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('MENU_GUARDED_SHARED_ENDPOINTS: 공용 API는 지정한 메뉴 목록으로 requireAnyMenuAccessApi를 호출', () => {
    for (const g of MENU_GUARDED_SHARED_ENDPOINTS) {
      for (const d of g.dirs) {
        const src = readFileSync(directServerFile(d), 'utf-8')
        const list = g.menuKeys.map((k) => `'${k}'`).join(', ')
        expect(src.includes(`requireAnyMenuAccessApi(locals, [${list}])`), `${d} 공용 게이트 없음`).toBe(true)
      }
    }
  })

  it('MENU_GUARDED_ACTION_FILES: 페이지 서버 파일이 requireMenuAccessAction을 호출', () => {
    for (const a of MENU_GUARDED_ACTION_FILES) {
      expect(readFileSync(join(ROOT, a.file), 'utf-8').includes(`requireMenuAccessAction(locals, '${a.menuKey}')`), a.file).toBe(true)
    }
  })

  it('MENU_GUARDED_LOADER_FILES: SSR 로더 파일이 지정한 게이트 호출을 가진다', () => {
    expect(MENU_GUARDED_LOADER_FILES.length).toBeGreaterThan(0)
    for (const l of MENU_GUARDED_LOADER_FILES) {
      expect(readFileSync(join(ROOT, l.file), 'utf-8').includes(l.marker), `${l.file} 에 ${l.marker} 없음`).toBe(true)
    }
  })

  it('매핑표의 모든 디렉터리·파일이 실존한다', () => {
    for (const v of Object.values(MENU_GUARDED_ENDPOINTS)) for (const d of v.dirs) expect(existsSync(directServerFile(d)), d).toBe(true)
    for (const g of MENU_GUARDED_SHARED_ENDPOINTS) for (const d of g.dirs) expect(existsSync(directServerFile(d)), d).toBe(true)
    for (const a of MENU_GUARDED_ACTION_FILES) expect(existsSync(join(ROOT, a.file)), a.file).toBe(true)
  })

  it('공용 API 디렉터리는 고객용 금지 목록과 겹치지 않는다', () => {
    for (const g of MENU_GUARDED_SHARED_ENDPOINTS) {
      for (const d of g.dirs) {
        expect(MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS.some((f) => d === f || d.startsWith(`${f}/`)), d).toBe(false)
      }
    }
  })
})
