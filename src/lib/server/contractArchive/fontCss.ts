/**
 * fontCss.ts — 최종본 PDF용 한글 폰트(@font-face) 임베드
 *
 * 서버(Vercel Lambda)의 Chromium에는 한글 폰트가 없어 시스템 폰트에 기대면 글자가 깨진다.
 * Noto Sans KR(SIL OFL, fonts/OFL-LICENSE.txt)의 한글 전 구간(11,172자)·라틴·기호를 굵기별 woff2 한 파일로
 * 합쳐 저장소에 두고, Vite `?inline`으로 빌드 시점에 base64 data URI로 번들한다 — 런타임 외부 요청 없음.
 *
 * 출처: @fontsource/noto-sans-kr 슬라이스(120개+latin)를 fontTools로 병합(굵기 400·700). 재생성이 필요하면
 *   devDependency로 @fontsource/noto-sans-kr을 설치하고 병합 스크립트(TASK.md 기록)를 다시 실행한다.
 */
import font400 from './fonts/NotoSansKR-400.woff2?inline'
import font700 from './fonts/NotoSansKR-700.woff2?inline'

export const ARCHIVE_FONT_FAMILY = 'Archive KR'

export const ARCHIVE_FONT_CSS =
  `@font-face{font-family:'${ARCHIVE_FONT_FAMILY}';font-weight:400;font-style:normal;src:url(${font400}) format('woff2')}` +
  `@font-face{font-family:'${ARCHIVE_FONT_FAMILY}';font-weight:700;font-style:normal;src:url(${font700}) format('woff2')}`
