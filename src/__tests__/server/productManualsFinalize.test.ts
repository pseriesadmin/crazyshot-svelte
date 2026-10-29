import { describe, it, expect, vi } from 'vitest'
import { manualPathInUse, adoptTempManualFiles, persistAdoptedManualFiles } from '$lib/server/products/manualFileFinalize'
import type { ProductManualFile } from '$lib/utils/productManuals'

/**
 * 상품설명서 임시(temp/) 파일의 소유 확인과 등록 직후 이관 (sp3 M1 보완, 2026-10-29)
 * - 이미 어떤 상품에 연결된 경로는 "임시 파일 삭제"로 지우거나 다른 상품 등록에 재사용할 수 없다
 * - 상품 등록이 끝나면 temp/ 경로의 파일을 {상품id}/ 폴더로 옮겨 임시 경로가 남지 않게 한다
 */
const PID = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
const U1 = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb'
const U2 = 'cccccccc-1111-4222-8333-dddddddddddd'
const f = (path: string): ProductManualFile => ({ path, name: `${path.slice(-8)}`, size: 100, uploaded_at: '2026-10-29T00:00:00.000Z' })

function fakeAdmin(opts: { usedRows?: unknown[]; usedError?: boolean; moveFail?: Set<string> }) {
  const moves: Array<[string, string]> = []
  const containsArgs: unknown[] = []
  const admin = {
    from: () => ({
      select: () => ({
        contains: (_col: string, val: unknown) => {
          containsArgs.push(val)
          return { limit: async () => (opts.usedError ? { data: null, error: { message: 'x' } } : { data: opts.usedRows ?? [], error: null }) }
        },
      }),
    }),
    storage: {
      from: () => ({
        move: async (from: string, to: string) => {
          moves.push([from, to])
          return opts.moveFail?.has(from) ? { error: { message: 'fail' } } : { error: null }
        },
      }),
    },
  }
  return { admin: admin as never, moves, containsArgs }
}

describe('manualPathInUse', () => {
  it('상품에 연결돼 있으면 true, 없으면 false, 조회 실패는 null(안전하게 거절 판단용)', async () => {
    const p = `temp/abc123_xyz/${U1}.pdf`
    expect(await manualPathInUse(fakeAdmin({ usedRows: [{ id: 'x' }] }).admin, p)).toBe(true)
    expect(await manualPathInUse(fakeAdmin({ usedRows: [] }).admin, p)).toBe(false)
    expect(await manualPathInUse(fakeAdmin({ usedError: true }).admin, p)).toBeNull()
  })
  it('그 경로가 들어 있는 상품을 찾는 조건으로 조회한다', async () => {
    const p = `temp/abc123_xyz/${U1}.pdf`
    const { admin, containsArgs } = fakeAdmin({})
    await manualPathInUse(admin, p)
    expect(containsArgs[0]).toEqual([{ path: p }])
  })
})

describe('adoptTempManualFiles', () => {
  it('temp/ 파일은 {상품id}/ 로 옮기고 같은 uuid 파일명을 유지한다', async () => {
    const { admin, moves } = fakeAdmin({})
    const out = await adoptTempManualFiles(admin, PID, [f(`temp/abc123_xyz/${U1}.pdf`), f(`temp/abc123_xyz/${U2}.pdf`)])
    expect(moves).toEqual([
      [`temp/abc123_xyz/${U1}.pdf`, `${PID}/${U1}.pdf`],
      [`temp/abc123_xyz/${U2}.pdf`, `${PID}/${U2}.pdf`],
    ])
    expect(out.changed).toBe(true)
    expect(out.files.map((x) => x.path)).toEqual([`${PID}/${U1}.pdf`, `${PID}/${U2}.pdf`])
    expect(out.moved).toEqual([
      { from: `temp/abc123_xyz/${U1}.pdf`, to: `${PID}/${U1}.pdf` },
      { from: `temp/abc123_xyz/${U2}.pdf`, to: `${PID}/${U2}.pdf` },
    ])
  })
  it('옮기기에 실패한 파일은 기존 temp 경로를 그대로 둔다(저장 실패로 만들지 않음)', async () => {
    const bad = `temp/abc123_xyz/${U1}.pdf`
    const { admin } = fakeAdmin({ moveFail: new Set([bad]) })
    const out = await adoptTempManualFiles(admin, PID, [f(bad), f(`temp/abc123_xyz/${U2}.pdf`)])
    expect(out.files[0].path).toBe(bad)
    expect(out.files[1].path).toBe(`${PID}/${U2}.pdf`)
    expect(out.changed).toBe(true)
  })
  it('temp/ 가 아닌 파일·빈 목록은 건드리지 않는다', async () => {
    const { admin, moves } = fakeAdmin({})
    const out = await adoptTempManualFiles(admin, PID, [f(`${PID}/${U1}.pdf`)])
    expect(moves).toEqual([])
    expect(out.changed).toBe(false)
    expect((await adoptTempManualFiles(admin, PID, [])).files).toEqual([])
  })
  it('이관 이름 충돌 등 예외가 나도 던지지 않는다', async () => {
    const admin = { storage: { from: () => ({ move: vi.fn().mockRejectedValue(new Error('boom')) }) } } as never
    const p = `temp/abc123_xyz/${U1}.pdf`
    const out = await adoptTempManualFiles(admin, PID, [f(p)])
    expect(out.files[0].path).toBe(p)
    expect(out.changed).toBe(false)
  })
})

describe('persistAdoptedManualFiles — 이관 후 저장 실패 시 깨진 링크 방지', () => {
  function persistAdmin(updateResults: Array<{ error: unknown }>, moveFail = new Set<string>()) {
    const moves: Array<[string, string]> = []
    let updates = 0
    const admin = {
      from: () => ({ update: () => ({ eq: async () => updateResults[Math.min(updates++, updateResults.length - 1)] }) }),
      storage: {
        from: () => ({
          move: async (from: string, to: string) => {
            moves.push([from, to])
            return moveFail.has(from) ? { error: { message: 'fail' } } : { error: null }
          },
        }),
      },
    }
    return { admin: admin as never, moves, updateCount: () => updates }
  }
  const adopted = (changed = true) => ({
    changed,
    files: [f(`${PID}/${U1}.pdf`)],
    moved: [{ from: `temp/abc123_xyz/${U1}.pdf`, to: `${PID}/${U1}.pdf` }],
  })

  it('저장이 성공하면 true, 파일은 그대로 둔다', async () => {
    const { admin, moves } = persistAdmin([{ error: null }])
    expect(await persistAdoptedManualFiles(admin, PID, adopted())).toBe(true)
    expect(moves).toEqual([])
  })

  it('첫 저장이 실패해도 한 번 더 시도해 성공하면 true, 파일은 그대로 둔다', async () => {
    const { admin, moves, updateCount } = persistAdmin([{ error: { message: 'x' } }, { error: null }])
    expect(await persistAdoptedManualFiles(admin, PID, adopted())).toBe(true)
    expect(updateCount()).toBe(2)
    expect(moves).toEqual([])
  })

  it('두 번 모두 실패하면 옮긴 파일을 임시 위치로 되돌려 상품에 남은 링크가 깨지지 않게 하고 false', async () => {
    const { admin, moves } = persistAdmin([{ error: { message: 'x' } }])
    expect(await persistAdoptedManualFiles(admin, PID, adopted())).toBe(false)
    expect(moves).toEqual([[`${PID}/${U1}.pdf`, `temp/abc123_xyz/${U1}.pdf`]])
  })

  it('되돌리기가 실패해도 예외를 던지지 않고 false', async () => {
    const { admin } = persistAdmin([{ error: { message: 'x' } }], new Set([`${PID}/${U1}.pdf`]))
    await expect(persistAdoptedManualFiles(admin, PID, adopted())).resolves.toBe(false)
  })

  it('이관된 파일이 없으면(changed=false) 저장·되돌리기 없이 true', async () => {
    const { admin, updateCount } = persistAdmin([{ error: { message: 'x' } }])
    expect(await persistAdoptedManualFiles(admin, PID, { changed: false, files: [], moved: [] })).toBe(true)
    expect(updateCount()).toBe(0)
  })
})
