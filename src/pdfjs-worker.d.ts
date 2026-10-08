// pdfjs-dist 워커 모듈에는 타입 선언이 없다 — 서버에서 PDF 쪽별 텍스트를 뽑을 때(contractArchive/pdfFingerprint.ts) 워커를 직접 불러 번들에 포함시키기 위한 선언.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
