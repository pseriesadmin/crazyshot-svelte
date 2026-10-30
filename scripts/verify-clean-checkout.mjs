#!/usr/bin/env node
// 깨끗한 사본 검사 — "커밋된 상태 그대로" 정의 누락(import 빠짐·없는 모듈·없는 컴포넌트)을 잡는다.
// 배경(2026-10-30): 한 파일에 여러 세션의 변경이 섞인 채 일부만 커밋돼 `SeoHead is not defined`가 실서비스에서 터졌다.
//   작업 폴더에는 미커밋 변경이 다 있어 로컬 테스트·타입 검사는 통과했다.
// 사용: node scripts/verify-clean-checkout.mjs [ref]   (ref 기본값 HEAD — 푸시 전엔 HEAD, 배포 후엔 origin/main)
// 읽기 전용: 임시 폴더에 detached worktree를 만들고 검사 후 반드시 제거한다. 작업 폴더·브랜치는 건드리지 않는다.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ref = process.argv[2] ?? 'HEAD'
const repo = resolve(process.cwd())
const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// 정의 누락 계열만 실패로 본다. $env(.env 없는 사본의 환경변수 노이즈)·기존 타입 부채는 제외.
const MISSING_DEFINITION = [
  /Cannot find name '/,
  /Cannot find module '/,
  /Cannot find namespace '/,
  /has no default export/,
  /is not defined/,
  /Could not resolve/,
]

const sha = git(['rev-parse', '--short', ref])
const dir = mkdtempSync(join(tmpdir(), 'cs-clean-'))
let exitCode = 0
try {
  git(['worktree', 'add', '--detach', dir, ref])
  if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'))
  const run = (cmd, args) => {
    try {
      return { out: execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }), code: 0 }
    } catch (e) {
      return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 }
    }
  }
  run('npx', ['svelte-kit', 'sync'])
  const { out } = run('npx', ['svelte-check', '--threshold', 'error', '--output', 'machine'])
  const errors = out.split('\n').filter((l) => / ERROR /.test(l))
  const hits = errors.filter((l) => !/\$env\/(static|dynamic)/.test(l) && MISSING_DEFINITION.some((re) => re.test(l)))
  console.log(`[clean-checkout] ref=${ref} (${sha}) — 전체 오류 ${errors.length}건 중 정의 누락 ${hits.length}건`)
  if (hits.length) {
    for (const l of hits) console.log('  ✗', l.replace(/^\d+ ERROR /, ''))
    console.log('→ 커밋된 파일 조합에서 import/모듈이 빠졌습니다. 같은 파일을 다른 세션이 건드렸는지 `git diff HEAD -- <파일>`로 확인하세요.')
    exitCode = 1
  } else {
    console.log('✓ 커밋된 상태 그대로 정의 누락 없음')
  }
} finally {
  try {
    git(['worktree', 'remove', '--force', dir])
  } catch {
    rmSync(dir, { recursive: true, force: true })
    try { git(['worktree', 'prune']) } catch { /* 정리 실패는 검사 결과에 영향 없음 */ }
  }
}
process.exit(exitCode)
