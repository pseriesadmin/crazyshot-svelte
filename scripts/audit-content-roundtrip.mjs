#!/usr/bin/env node
/**
 * 콘텐츠 에디터 왕복 전수 점검 (읽기 전용 — 어떤 DB에도 쓰지 않는다)
 *
 * 모든 상품·구독·크레이지로그의 content_blocks를 새 변환기(contentBlocksTiptap.ts)로 왕복시켜
 * 레코드별로 "변환 가능 / 원본 보존" 분류와 글자 일치 여부를 보고한다.
 * 합격 기준: 변환 가능으로 분류된 블록 중 글자 불일치 0건, 보존 블록 중 원본이 달라진 것 0건.
 *
 * 실행 (Stage 전용 — Production은 기본 거부):
 *   node --env-file=.env.local scripts/audit-content-roundtrip.mjs
 *   node scripts/audit-content-roundtrip.mjs --input ./rows.json     # [{table,id,content_blocks}] 파일 입력
 *   옵션: --out <리포트 .md 경로>
 */
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const STAGE_REF = 'ezyvffjvuwmtuhpxdjrw'
const args = process.argv.slice(2)
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }

// ── DOM 전역 준비 (tiptap·DOMParser가 document를 쓴다) ──
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const w = dom.window
for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'Element', 'Node', 'Text', 'Range', 'Selection', 'MutationObserver', 'getComputedStyle', 'DocumentFragment', 'HTMLTemplateElement', 'XMLSerializer']) {
  if (!(key in globalThis) || key === 'window' || key === 'document') {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? w : w[key], configurable: true, writable: true })
  }
}

async function loadRows() {
  const input = argVal('--input')
  if (input) return JSON.parse(readFileSync(input, 'utf8'))
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다(--env-file=.env.local).')
  if (!url.includes(STAGE_REF)) throw new Error(`Stage(${STAGE_REF})가 아닌 DB에는 실행하지 않습니다: ${url}`)
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const sources = [
    { table: 'products', cols: 'id,name,content_blocks', filter: (q) => q.is('deleted_at', null) },
    { table: 'subscription_plans', cols: 'id,name,content_blocks', filter: (q) => q },
    { table: 'user_posts', cols: 'id,title,content_blocks', filter: (q) => q },
  ]
  const rows = []
  for (const s of sources) {
    for (let from = 0; ; from += 500) {
      const { data, error } = await s.filter(sb.from(s.table).select(s.cols)).range(from, from + 499)
      if (error) { console.warn(`[skip] ${s.table}: ${error.message}`); break }
      if (!data?.length) break
      for (const r of data) rows.push({ table: s.table, id: r.id, label: r.name ?? r.title ?? '', content_blocks: r.content_blocks })
      if (data.length < 500) break
    }
  }
  return rows
}

const root = path.resolve(new URL('..', import.meta.url).pathname)
const server = await createServer({
  root, configFile: false, appType: 'custom', logLevel: 'error',
  server: { middlewareMode: true },
  resolve: { alias: { $lib: path.join(root, 'src/lib') } },
  optimizeDeps: { noDiscovery: true, include: [] },
})

try {
  const { auditBlocks } = await server.ssrLoadModule('/src/lib/utils/contentAudit.ts')
  const rows = await loadRows()
  const total = { records: 0, textBlocks: 0, htmlBlocks: 0, convertible: 0, preserved: 0, mismatchConvertible: 0, preservedAltered: 0, reasons: {} }
  const perTable = {}
  const problems = []
  for (const row of rows) {
    const a = auditBlocks(row.content_blocks)
    if (a.textBlocks + a.htmlBlocks + a.mediaBlocks === 0) continue
    total.records++
    const t = (perTable[row.table] ??= { records: 0, convertible: 0, preserved: 0 })
    t.records++; t.convertible += a.convertible; t.preserved += a.preserved
    for (const k of ['textBlocks', 'htmlBlocks', 'convertible', 'preserved', 'mismatchConvertible', 'preservedAltered']) total[k] += a[k]
    for (const [r, n] of Object.entries(a.reasons)) total.reasons[r] = (total.reasons[r] ?? 0) + n
    if (a.mismatchConvertible || a.preservedAltered) problems.push({ table: row.table, id: row.id, label: row.label, ...a })
  }
  const pass = total.mismatchConvertible === 0 && total.preservedAltered === 0
  const topReasons = Object.entries(total.reasons).sort((x, y) => y[1] - x[1]).slice(0, 15)
  const md = [
    `# 콘텐츠 에디터 왕복 전수 점검 리포트 (${new Date().toISOString().slice(0, 10)})`,
    '',
    `- 판정: **${pass ? '합격' : '불합격'}** (변환 가능 블록 글자 불일치 ${total.mismatchConvertible}건 · 보존 블록 원본 변경 ${total.preservedAltered}건)`,
    `- 점검 레코드 ${total.records}건 · text 블록 ${total.textBlocks} · html 블록 ${total.htmlBlocks}`,
    `- 변환 가능 ${total.convertible} / 원본 보존 ${total.preserved} (보존 비율 ${total.textBlocks + total.htmlBlocks ? Math.round((total.preserved / (total.textBlocks + total.htmlBlocks)) * 100) : 0}%)`,
    '', '## 테이블별', '', '| 테이블 | 레코드 | 변환 가능 | 보존 |', '|---|---|---|---|',
    ...Object.entries(perTable).map(([k, v]) => `| ${k} | ${v.records} | ${v.convertible} | ${v.preserved} |`),
    '', '## 보존 사유 상위', '', ...topReasons.map(([r, n]) => `- \`${r}\` ${n}건`),
    '', '## 문제 레코드', '', ...(problems.length ? problems.map((p) => `- ${p.table} ${p.id} (${p.label}) 불일치 ${p.mismatchConvertible} / 변경 ${p.preservedAltered}`) : ['- 없음']),
    '',
  ].join('\n')
  console.log(md)
  const out = argVal('--out')
  if (out) writeFileSync(out, md)
  process.exitCode = pass ? 0 : 1
} finally {
  await server.close()
}
