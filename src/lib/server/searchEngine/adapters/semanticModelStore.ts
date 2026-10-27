/**
 * adapters/semanticModelStore.ts — 의미 벡터 모델의 빌드·저장·로드 (서버 전용, service_role)
 *
 * 흐름: 말뭉치 조회(semanticCorpus 화이트리스트) → 입력 해시가 직전 모델과 같으면 건너뜀 → 모델 빌드 → 파일 업로드(비공개 버킷) →
 * "업로드가 끝난 뒤에" 메타 행 삽입 → 오래된 모델 정리. 실패하면 이전 모델이 그대로 남는다(새 행을 넣기 전에는 아무것도 바뀌지 않음).
 * (환경변수·모듈 캐시는 semanticModelCache.ts — 이 파일은 $env 없이 스크립트에서도 쓸 수 있다.)
 * 로드: 가장 최근 ready 행의 파일을 받아 SHA-256을 검증하고 역직렬화한다. 어떤 단계든 실패하면 null(= 의미 점수 꺼짐 = 기존 검색 결과와 동일).
 * ⛔ 로그·반환값에는 숫자·상태만 싣는다(말뭉치 문구·상품명·원문 없음).
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildSemanticModel,
  deserializeSemanticModel,
  serializeSemanticModel,
  type CorpusDoc,
  type SemanticModel,
} from '../core/semanticVectors'
import { buildSemanticCorpus, type SemanticCorpus, type SemanticCorpusInput } from './semanticCorpus'

export const SEMANTIC_BUCKET = 'nlsearch-models'
const KEEP_VERSIONS = 3
const LEARNED_MIN_USERS = 3 // 기본 learning.minUsers 와 같게 고정(CMS 설정과는 연동하지 않음 — 말뭉치 지문 안정)

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** 말뭉치 입력 해시 — 순서·가중까지 포함해 같은 입력이면 항상 같다 */
export function hashCorpus(docs: readonly CorpusDoc[]): string {
  const h = createHash('sha256')
  for (const d of docs) h.update(`${d.weight ?? 1}\u0001${d.text}\u0002`)
  return h.digest('hex')
}

async function must<T>(label: string, p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p
  if (error) throw new Error(`${label}: ${error.message}`)
  return data ?? []
}

type Rows = Record<string, unknown>[]

/** 허용 소스 7종만 읽는다(채팅·검색 로그·분류 로그는 읽지 않는다). 한 소스라도 실패하면 예외 → 이전 모델 유지 */
export async function loadSemanticCorpusInput(admin: SupabaseClient): Promise<SemanticCorpusInput> {
  const [products, reviews, posts, comments, canned, synonymRows, statsRows] = await Promise.all([
    must<Record<string, unknown>>('products', admin.from('products').select('id, name, brand, category, slug, product_caption, keywords, content_blocks, components, specifications').is('parent_product_id', null).eq('is_active', true).eq('option_only', false).is('deleted_at', null)),
    must<Record<string, unknown>>('product_reviews', admin.from('product_reviews').select('title, content, is_public').eq('is_public', true).limit(5000)),
    must<Record<string, unknown>>('user_posts', admin.from('user_posts').select('id, title, content_blocks, keywords, tags, is_public, status, allow_ai_save').eq('status', 'published').eq('is_public', true).eq('allow_ai_save', true)),
    must<Record<string, unknown>>('post_comments', admin.from('post_comments').select('post_id, content, is_public').eq('is_public', true).limit(10000)),
    must<Record<string, unknown>>('canned_responses', admin.from('canned_responses').select('title, content, match_keywords, pending_review').eq('pending_review', false)),
    must<{ term: string; synonym_groups: { canonical_term: string } }>('synonym_group_members', admin.from('synonym_group_members').select('term, synonym_groups!inner(canonical_term)').eq('status', 'confirmed').returns<{ term: string; synonym_groups: { canonical_term: string } }[]>()),
    must<{ product_id: string; search_term: string }>('product_search_stats', admin.from('product_search_stats').select('product_id, search_term').gte('click_user_count', LEARNED_MIN_USERS).returns<{ product_id: string; search_term: string }[]>()),
  ])

  const groupMap = new Map<string, string[]>()
  for (const r of synonymRows) {
    const key = r.synonym_groups.canonical_term
    groupMap.set(key, [...(groupMap.get(key) ?? []), r.term])
  }
  const nameById = new Map(products.map((p) => [String(p['id']), String(p['name'] ?? '')]))
  return {
    products,
    reviews,
    posts,
    comments,
    canned,
    synonymGroups: [...groupMap.entries()].map(([canonicalTerm, confirmedTerms]) => ({ canonicalTerm, confirmedTerms })),
    learned: statsRows.map((r) => ({ search_term: r.search_term, product_name: nameById.get(String(r.product_id)) ?? '' })).filter((r) => r.product_name),
  }
}

export type BuildOutcome =
  | { status: 'built'; version: number; vocabSize: number; dim: number; corpusDocs: number; buildMs: number; stats: SemanticCorpus['stats'] }
  | { status: 'skipped'; reason: 'same_corpus'; version: number; corpusDocs: number }
  | { status: 'failed'; reason: string }

/** 모델을 빌드해 저장한다. force=true면 같은 입력이어도 다시 만든다. */
export async function buildAndStoreSemanticModel(admin: SupabaseClient, opts: { force?: boolean } = {}): Promise<BuildOutcome> {
  const started = Date.now()
  try {
    const corpus = buildSemanticCorpus(await loadSemanticCorpusInput(admin))
    const corpusHash = hashCorpus(corpus.docs)

    const { data: latest, error: latestErr } = await admin
      .from('nlsearch_vector_models')
      .select('version, corpus_hash')
      .eq('status', 'ready')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestErr) throw new Error(`latest model: ${latestErr.message}`)
    if (!opts.force && latest && latest.corpus_hash === corpusHash) {
      return { status: 'skipped', reason: 'same_corpus', version: latest.version as number, corpusDocs: corpus.docs.length }
    }

    const model = buildSemanticModel(corpus.docs)
    const bytes = serializeSemanticModel(model)
    const fileHash = sha256(bytes)

    const { data: maxRow, error: maxErr } = await admin.from('nlsearch_vector_models').select('version').order('version', { ascending: false }).limit(1).maybeSingle()
    if (maxErr) throw new Error(`max version: ${maxErr.message}`)
    let version = ((maxRow?.version as number | undefined) ?? 0) + 1

    // 업로드가 끝난 "뒤에" 행을 넣는다 — 행이 보이면 파일은 항상 완성돼 있다.
    // 같은 이름의 파일이 이미 있으면(이전 실행이 행 삽입 전에 중단돼 남은 고아 파일) 다음 번호로 재시도한다(매일 밤 같은 이유로 실패하는 것 방지).
    let path = `semantic-v${version}.bin`
    let uploaded = false
    for (let attempt = 0; attempt < 5 && !uploaded; attempt++) {
      const up = await admin.storage.from(SEMANTIC_BUCKET).upload(path, bytes, { contentType: 'application/octet-stream', upsert: false })
      if (!up.error) {
        uploaded = true
        break
      }
      if (!/exist|duplicate/i.test(up.error.message)) throw new Error(`upload: ${up.error.message}`)
      version++
      path = `semantic-v${version}.bin`
    }
    if (!uploaded) throw new Error('upload: 사용 가능한 파일 이름을 찾지 못함')
    const ins = await admin.from('nlsearch_vector_models').insert({
      version,
      dim: model.dim,
      vocab_size: model.vocab.length,
      corpus_hash: corpusHash,
      file_hash: fileHash,
      storage_path: path,
      status: 'ready',
      corpus_stats: { docs: corpus.stats.docs, droppedUnsafe: corpus.stats.droppedUnsafe, droppedWords: corpus.stats.droppedWords, corpusDocs: corpus.docs.length },
    })
    if (ins.error) {
      await admin.storage.from(SEMANTIC_BUCKET).remove([path]) // 행이 없으면 고아 파일 — 정리(실패해도 다음 실행이 다른 번호를 쓴다)
      throw new Error(`insert: ${ins.error.message}`)
    }

    await retireOldVersions(admin, version).catch((e: unknown) => console.error('[semanticModelStore] 오래된 모델 정리 실패:', e instanceof Error ? e.message : String(e)))
    return { status: 'built', version, vocabSize: model.vocab.length, dim: model.dim, corpusDocs: corpus.docs.length, buildMs: Date.now() - started, stats: corpus.stats }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.error('[semanticModelStore] 모델 빌드 실패(이전 모델 유지):', reason)
    return { status: 'failed', reason }
  }
}

async function retireOldVersions(admin: SupabaseClient, latestVersion: number): Promise<void> {
  const cutoff = latestVersion - KEEP_VERSIONS
  if (cutoff < 1) return
  const { data } = await admin.from('nlsearch_vector_models').select('version, storage_path').eq('status', 'ready').lte('version', cutoff)
  const old = (data ?? []) as { version: number; storage_path: string }[]
  if (old.length === 0) return
  await admin.storage.from(SEMANTIC_BUCKET).remove(old.map((o) => o.storage_path))
  await admin.from('nlsearch_vector_models').update({ status: 'retired' }).in('version', old.map((o) => o.version))
}

/** 가장 최근 ready 모델을 내려받아 검증·복원한다. 어떤 문제든 null. */
export async function loadLatestSemanticModel(admin: SupabaseClient): Promise<SemanticModel | null> {
  try {
    const { data, error } = await admin
      .from('nlsearch_vector_models')
      .select('storage_path, file_hash')
      .eq('status', 'ready')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const dl = await admin.storage.from(SEMANTIC_BUCKET).download(data.storage_path as string)
    if (dl.error || !dl.data) return null
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    if (sha256(bytes) !== data.file_hash) {
      console.error('[semanticModelStore] 모델 파일 해시 불일치 — 의미 점수를 끕니다')
      return null
    }
    return deserializeSemanticModel(bytes)
  } catch (e) {
    console.error('[semanticModelStore] 모델 로드 실패:', e instanceof Error ? e.message : String(e))
    return null
  }
}
