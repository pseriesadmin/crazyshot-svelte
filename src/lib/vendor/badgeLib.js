// 크레이지샷 배지 편집기 v1.0 — 원본 HTML(크레이지샷 배지 편집기v1.0.html)의 BadgeLib 를 그대로 옮긴 파일이다. 직접 고치지 말고 편집기 새 버전이 나오면 통째로 교체한다.
// ⚠️ 원본과 다른 점 1곳: esc() 에 큰따옴표·작은따옴표 치환 추가(aria-label 속성 주입 방지, sp3 2026-11-23). 새 버전으로 교체할 때 이 수정을 다시 넣을 것 — badgeImageEditor.mount.test.ts 가 막아 준다.
// 타입은 badgeLib.d.ts 가 정의한다(이 파일은 원본 보존을 위해 타입 검사에서 제외).
/* eslint-disable */
// @ts-nocheck
export const BadgeLib = (function () {
  var FONT = "'CrazyBadgeKR','Pretendard','Noto Sans KR','Noto Sans CJK KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
  var NAVY = '#25314A', GOLD = '#E8B84A';

  /* ---------- 색상 도우미 ---------- */
  function h2r(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function r2h(a) { return '#' + a.map(function (v) { v = Math.round(Math.max(0, Math.min(255, v))); return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function mix(c, d, t) { var a = h2r(c), b = h2r(d); return r2h([0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; })); }
  function lighten(c, t) { return mix(c, '#ffffff', t); }
  function darken(c, t) { return mix(c, '#000000', t); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  /* ---------- 글자 폭 추정 (em 단위) ---------- */
  function em(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x3130 && c <= 0x318F)) w += 1;
      else if (c === 32) w += 0.3;
      else if (c >= 48 && c <= 57) w += 0.64;
      else if (c >= 65 && c <= 90) w += 0.74;
      else if (c >= 97 && c <= 122) w += 0.62;
      else w += 0.7;
    }
    return w || 1;
  }

  /* ---------- 글자 블록: 작은글자 / 메인(여러 줄 가능) / 아래글자 ---------- */
  function userWrap(p, cx, cy, inner) {
    var dx = p.dx || 0, dy = p.dy || 0, tr = p.tr || 0;
    if (!dx && !dy && !tr) return inner;
    var g = '<g transform="translate(' + dx + ' ' + dy + ')">' + inner + '</g>';
    if (tr) g = '<g transform="rotate(' + tr + ' ' + (cx + dx) + ' ' + (cy + dy) + ')">' + g + '</g>';
    return g;
  }
  function textBlock(p, cx, cy, maxW, sz, rot) {
    var k = p.scale || 1, lines = [];
    var mains = String(p.main || '').split('\n').filter(function (x) { return x.length; });
    var mm = 1e9;
    mains.forEach(function (m) { mm = Math.min(mm, maxW / em(m)); });
    if (p.small) lines.push({ t: p.small, s: Math.min(sz[0], maxW / em(p.small)) * k * (p.sm || 1), f: lighten(p.c2, 0.3), r: 'small' });
    mains.forEach(function (m) { lines.push({ t: m, s: Math.min(sz[1], mm) * k * (p.mm || 1), f: p.tc, r: 'main' }); });
    if (p.sub) lines.push({ t: p.sub, s: Math.min(sz[2], maxW / em(p.sub)) * k * (p.sb || 1), f: lighten(p.c2, 0.3), r: 'sub' });
    var gap = 6, total = -gap;
    lines.forEach(function (l) { total += l.s + gap; });
    var y = cy - total / 2, out = '';
    lines.forEach(function (l) {
      var base = y + l.s / 2 + l.s * 0.36;
      out += '<text x="' + cx + '" y="' + base.toFixed(1) + '" font-size="' + l.s.toFixed(1) + '" fill="' + l.f + '" text-anchor="middle" data-role="' + l.r + '">' + esc(l.t) + '</text>';
      y += l.s + gap;
    });
    out = '<g font-family="' + FONT + '" font-weight="900">' + out + '</g>';
    if (rot) out = '<g transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')">' + out + '</g>';
    return userWrap(p, cx, cy, out);
  }

  function star(cx, cy, r, fill) {
    var pts = [];
    for (var i = 0; i < 10; i++) { var rr = i % 2 ? r * 0.45 : r, a = (-90 + i * 36) * Math.PI / 180; pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); }
    return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '"/>';
  }
  function stars(cx, y, fill) { return star(cx - 24, y, 6.5, fill) + star(cx, y - 2, 8, fill) + star(cx + 24, y, 6.5, fill); }
  var SH = '#000';

  /* ---------- 템플릿 ---------- */
  var TPL = {};

  TPL.shield = { name: '방패 (프리미엄)', draw: function (p, id) {
    var d = 'M120 8 C88 28 52 34 18 32 V132 C18 188 66 232 120 258 C174 232 222 188 222 132 V32 C188 34 152 28 120 8 Z';
    var sc = 'translate(120 135) scale(.9) translate(-120 -135)';
    return { w: 240, h: 270, body:
      '<path d="' + d + '" transform="translate(4 9)" fill="' + SH + '" opacity=".2"/>' +
      '<path d="' + d + '" fill="url(#' + id + 'g)"/>' +
      '<path d="' + d + '" transform="' + sc + '" fill="url(#' + id + 'b)"/>' +
      '<path d="' + d + '" transform="translate(120 135) scale(.82) translate(-120 -135)" fill="none" stroke="' + p.c2 + '" stroke-opacity=".55" stroke-width="1.6"/>' +
      stars(120, 54, lighten(p.c2, .3)) +
      textBlock(p, 120, 146, 140, [28, 68, 24]) };
  } };

  TPL.medal = { name: '메달 + 리본', draw: function (p, id) {
    var rib = 'M70 168 L112 196 L98 260 L78 242 L58 256 Z';
    return { w: 240, h: 272, body:
      '<path d="' + rib + '" transform="translate(3 6)" fill="' + SH + '" opacity=".18"/>' +
      '<path d="' + rib + '" fill="url(#' + id + 'g)"/>' +
      '<g transform="translate(240 0) scale(-1 1)"><path d="' + rib + '" fill="' + darken(p.c2, .12) + '"/></g>' +
      '<circle cx="120" cy="116" r="100" transform="translate(4 8)" fill="' + SH + '" opacity=".2"/>' +
      '<circle cx="120" cy="112" r="100" fill="url(#' + id + 'g)"/>' +
      '<circle cx="120" cy="112" r="91" fill="url(#' + id + 'b)"/>' +
      '<circle cx="120" cy="112" r="80" fill="none" stroke="' + p.c2 + '" stroke-opacity=".6" stroke-width="1.6"/>' +
      stars(120, 52, lighten(p.c2, .3)) +
      textBlock(p, 120, 120, 128, [28, 66, 24]) };
  } };

  TPL.laurel = { name: '월계수 (랭킹)', draw: function (p, id) {
    var leaves = '', R = 88, N = 7;
    function pt(deg, r) { var t = deg * Math.PI / 180; return [120 + r * Math.cos(t), 124 + r * Math.sin(t)]; }
    for (var i = 0; i < N; i++) {
      var thd = 112 + i * (125 / (N - 1)), sz = 1 - i * 0.05;
      var o = pt(thd, R + 8), n = pt(thd, R - 8);
      leaves += '<ellipse cx="' + o[0].toFixed(1) + '" cy="' + o[1].toFixed(1) + '" rx="' + (6.5 * sz).toFixed(1) + '" ry="' + (15 * sz).toFixed(1) + '" transform="rotate(' + (thd + 34).toFixed(1) + ' ' + o[0].toFixed(1) + ' ' + o[1].toFixed(1) + ')" fill="url(#' + id + 'g)"/>';
      leaves += '<ellipse cx="' + n[0].toFixed(1) + '" cy="' + n[1].toFixed(1) + '" rx="' + (6.5 * sz).toFixed(1) + '" ry="' + (15 * sz).toFixed(1) + '" transform="rotate(' + (thd - 34).toFixed(1) + ' ' + n[0].toFixed(1) + ' ' + n[1].toFixed(1) + ')" fill="' + darken(p.c2, .12) + '"/>';
    }
    var a = pt(104, R), b = pt(244, R);
    var stem = '<path d="M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' A' + R + ' ' + R + ' 0 0 1 ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + '" fill="none" stroke="' + p.c2 + '" stroke-width="3" stroke-linecap="round"/>';
    var branch = '<g>' + stem + leaves + '</g>';
    return { w: 240, h: 244, body:
      '<circle cx="124" cy="132" r="80" fill="' + SH + '" opacity=".2"/>' +
      branch + '<g transform="translate(240 0) scale(-1 1)">' + branch + '</g>' +
      '<circle cx="120" cy="124" r="74" fill="url(#' + id + 'b)"/>' +
      '<circle cx="120" cy="124" r="67" fill="none" stroke="' + p.c2 + '" stroke-opacity=".6" stroke-width="1.5"/>' +
      textBlock(p, 120, 126, 108, [26, 62, 22]) };
  } };

  TPL.burst = { name: '스타버스트 (강조)', draw: function (p, id) {
    function poly(o, i, n) { var pts = []; for (var k = 0; k < n * 2; k++) { var r = k % 2 ? i : o, a = (-90 + k * 180 / n) * Math.PI / 180; pts.push((120 + r * Math.cos(a)).toFixed(1) + ',' + (120 + r * Math.sin(a)).toFixed(1)); } return pts.join(' '); }
    return { w: 240, h: 248, body:
      '<polygon points="' + poly(116, 98, 14) + '" transform="translate(4 8)" fill="' + SH + '" opacity=".2" stroke-linejoin="round"/>' +
      '<polygon points="' + poly(116, 98, 14) + '" fill="url(#' + id + 'g)" stroke="url(#' + id + 'g)" stroke-width="6" stroke-linejoin="round"/>' +
      '<polygon points="' + poly(104, 90, 14) + '" fill="url(#' + id + 'b)" stroke="url(#' + id + 'b)" stroke-width="6" stroke-linejoin="round"/>' +
      textBlock(p, 120, 122, 138, [26, 70, 24], -6) };
  } };

  TPL.blob = { name: '둥근 사각 (BEST형)', draw: function (p, id) {
    return { w: 280, h: 236, body:
      '<rect x="20" y="22" width="240" height="190" rx="76" transform="translate(4 8)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="20" y="16" width="240" height="190" rx="76" fill="url(#' + id + 'g)"/>' +
      '<rect x="28" y="24" width="224" height="174" rx="68" fill="url(#' + id + 'b)"/>' +
      '<rect x="37" y="33" width="206" height="156" rx="60" fill="none" stroke="' + p.c2 + '" stroke-opacity=".55" stroke-width="1.6"/>' +
      stars(140, 52, lighten(p.c2, .3)) +
      textBlock(p, 140, 122, 170, [28, 64, 26]) };
  } };

  TPL.frame = { name: '가로 프레임 (FREE형)', draw: function (p, id) {
    return { w: 320, h: 172, body:
      '<rect x="10" y="16" width="300" height="142" rx="28" transform="translate(3 7)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="10" y="10" width="300" height="142" rx="28" fill="url(#' + id + 'g)"/>' +
      '<rect x="17" y="17" width="286" height="128" rx="22" fill="url(#' + id + 'b)"/>' +
      '<rect x="25" y="25" width="270" height="112" rx="16" fill="none" stroke="' + p.c2 + '" stroke-opacity=".5" stroke-width="1.4"/>' +
      textBlock(p, 160, 82, 224, [24, 54, 22]) };
  } };

  TPL.label = { name: '2단 라벨 (신제품형)', draw: function (p, id) {
    var top = 'M10 56 Q10 42 24 42 H246 Q260 42 260 56 V128 H10 Z';
    var bot = 'M10 128 H260 V162 Q260 178 244 178 H26 Q10 178 10 162 Z';
    var mainLines = String(p.main || '').split('\n')[0];
    var k = p.scale || 1;
    var ms = Math.min(52, 224 / em(mainLines)) * k * (p.mm || 1);
    var ss = Math.min(32, 216 / em(p.sub || ' ')) * k * (p.sb || 1);
    var sm = Math.min(28, 120 / em(p.small || ' ')) * k * (p.sm || 1);
    return { w: 270, h: 200, body:
      '<g transform="translate(4 8)" opacity=".2" fill="' + SH + '"><path d="' + top + '"/><path d="' + bot + '"/></g>' +
      '<path d="' + bot + '" fill="url(#' + id + 'g)"/>' +
      '<path d="' + top + '" fill="url(#' + id + 'b)"/>' +
      userWrap(p, 135, 100, '<g font-family="' + FONT + '" font-weight="900" text-anchor="middle">' +
      (p.small ? '<text x="64" y="32" font-size="' + sm.toFixed(1) + '" font-style="italic" fill="' + lighten(p.c2, .1) + '" transform="rotate(-8 64 32)" data-role="small">' + esc(p.small) + '</text>' : '') +
      '<text x="135" y="' + (85 + ms * 0.36).toFixed(1) + '" font-size="' + ms.toFixed(1) + '" fill="' + p.tc + '" data-role="main">' + esc(mainLines) + '</text>' +
      (p.sub ? '<text x="135" y="' + (153 + ss * 0.36).toFixed(1) + '" font-size="' + ss.toFixed(1) + '" fill="' + darken(p.c1, .25) + '" data-role="sub">' + esc(p.sub) + '</text>' : '') +
      '</g>') };
  } };

  /* ---------- 가격표 / 깃발 / 양쪽 리본 / 말풍선 ---------- */
  function glossTop(id, d, o) { return '<path d="' + d + '" fill="#fff" opacity="' + (o || 0.16) + '" />'; }

  TPL.tagprice = { name: '가격표 태그 (구멍·끈)', draw: function (p, id) {
    var d = 'M12 98 L58 30 Q64 22 74 22 H274 Q288 22 288 36 V160 Q288 174 274 174 H74 Q64 174 58 166 Z';
    return { w: 300, h: 196, body:
      '<path d="M62 98 C42 74 34 44 18 16" fill="none" stroke="' + darken(p.c1, .35) + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="' + d + '" transform="translate(4 9)" fill="' + SH + '" opacity=".2"/>' +
      '<path d="' + d + '" fill="url(#' + id + 'b)"/>' +
      '<rect x="74" y="28" width="206" height="46" rx="14" fill="#fff" opacity=".14"/>' +
      '<circle cx="64" cy="98" r="13" fill="' + darken(p.c1, .5) + '"/>' +
      '<circle cx="64" cy="98" r="13" fill="none" stroke="' + p.c2 + '" stroke-opacity=".9" stroke-width="3"/>' +
      textBlock(p, 180, 99, 172, [24, 60, 22], -2) };
  } };

  TPL.banner = { name: '깃발 배너 (세로)', draw: function (p, id) {
    var d = 'M34 28 H186 V246 L110 204 L34 246 Z';
    return { w: 220, h: 270, body:
      '<path d="' + d + '" transform="translate(4 8)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="16" y="10" width="188" height="20" rx="10" fill="url(#' + id + 'g)"/>' +
      '<path d="' + d + '" fill="url(#' + id + 'b)"/>' +
      '<path d="M46 40 H174" stroke="' + p.c2 + '" stroke-opacity=".55" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/>' +
      '<rect x="34" y="28" width="152" height="40" fill="#fff" opacity=".12"/>' +
      textBlock(p, 110, 124, 118, [24, 56, 22]) };
  } };

  TPL.ribbon2 = { name: '양쪽 접힘 리본', draw: function (p, id) {
    var dark = darken(p.c1, .32);
    return { w: 340, h: 176, body:
      '<g transform="translate(4 9)" opacity=".2" fill="' + SH + '"><path d="M8 52 H86 V134 H8 L32 93 Z"/><path d="M332 52 H254 V134 H332 L308 93 Z"/><rect x="50" y="34" width="240" height="82"/></g>' +
      '<path d="M8 52 H86 V134 H8 L32 93 Z" fill="' + dark + '"/>' +
      '<path d="M332 52 H254 V134 H332 L308 93 Z" fill="' + dark + '"/>' +
      '<path d="M50 116 H86 V134 Z" fill="' + darken(p.c1, .55) + '"/>' +
      '<path d="M290 116 H254 V134 Z" fill="' + darken(p.c1, .55) + '"/>' +
      '<rect x="50" y="34" width="240" height="82" fill="url(#' + id + 'b)"/>' +
      '<rect x="50" y="34" width="240" height="30" fill="#fff" opacity=".14"/>' +
      textBlock(p, 170, 76, 200, [22, 52, 20]) };
  } };

  TPL.bubble = { name: '말풍선', draw: function (p, id) {
    var d = 'M52 14 H248 Q290 14 290 56 V122 Q290 164 248 164 H128 L74 208 L84 164 H52 Q10 164 10 122 V56 Q10 14 52 14 Z';
    return { w: 304, h: 224, body:
      '<path d="' + d + '" transform="translate(4 9)" fill="' + SH + '" opacity=".2"/>' +
      '<path d="' + d + '" fill="url(#' + id + 'b)"/>' +
      '<rect x="22" y="20" width="256" height="44" rx="22" fill="#fff" opacity=".14"/>' +
      textBlock(p, 150, 90, 206, [24, 58, 22], -2) };
  } };

  /* ---------- V 체크포인트형 ---------- */
  function checkMark(cx, cy, k, color, sw) {
    return '<path d="M' + (cx - 0.5 * k).toFixed(1) + ' ' + (cy + 0.04 * k).toFixed(1) + ' L' + (cx - 0.14 * k).toFixed(1) + ' ' + (cy + 0.4 * k).toFixed(1) + ' L' + (cx + 0.54 * k).toFixed(1) + ' ' + (cy - 0.38 * k).toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  function wavyPath(R, A, n, cx, cy) {
    var d = '';
    for (var i = 0; i < 360; i++) { var t = i / 360 * 2 * Math.PI, r = R + A * Math.cos(n * t), a = t - Math.PI / 2; d += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1); }
    return d + 'Z';
  }
  TPL.checkseal = { name: 'V 체크 인증 씰', draw: function (p, id) {
    var outer = wavyPath(102, 6, 12, 120, 122), inner = wavyPath(92, 5, 12, 120, 122);
    return { w: 240, h: 250, body:
      '<path d="' + outer + '" transform="translate(4 9)" fill="' + SH + '" opacity=".2"/>' +
      '<path d="' + outer + '" fill="url(#' + id + 'g)"/>' +
      '<path d="' + inner + '" fill="url(#' + id + 'b)"/>' +
      '<circle cx="120" cy="80" r="31" fill="url(#' + id + 'g)"/>' +
      '<circle cx="120" cy="80" r="31" fill="none" stroke="#FFF" stroke-opacity=".5" stroke-width="2"/>' +
      checkMark(120, 80, 33, darken(p.c1, .1), 9) +
      textBlock(p, 120, 164, 112, [22, 40, 20]) };
  } };
  TPL.checkpill = { name: 'V 체크 알약 (가로)', draw: function (p, id) {
    return { w: 330, h: 110, body:
      '<rect x="8" y="12" width="314" height="90" rx="45" transform="translate(3 6)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="8" y="8" width="314" height="90" rx="45" fill="url(#' + id + 'g)"/>' +
      '<rect x="14" y="14" width="302" height="78" rx="39" fill="url(#' + id + 'b)"/>' +
      '<circle cx="58" cy="53" r="32" fill="url(#' + id + 'g)"/>' +
      '<circle cx="58" cy="53" r="32" fill="none" stroke="#FFF" stroke-opacity=".5" stroke-width="2"/>' +
      checkMark(58, 53, 36, darken(p.c1, .1), 9) +
      textBlock(p, 194, 53, 170, [20, 44, 20]) };
  } };

  /* ---------- 플랫 스티커형 (그림자·그라데이션 없음) ---------- */
  function polarPath(fn) {
    var d = '', steps = 360;
    for (var i = 0; i < steps; i++) {
      var t = i / steps * 2 * Math.PI, r = fn(t), a = t - Math.PI / 2;
      d += (i ? 'L' : 'M') + (120 + r * Math.cos(a)).toFixed(1) + ' ' + (120 + r * Math.sin(a)).toFixed(1);
    }
    return d + 'Z';
  }
  function starPts(n, out, inn) {
    var pts = [];
    for (var k = 0; k < n * 2; k++) { var r = k % 2 ? inn : out, a = (-90 + k * 180 / n) * Math.PI / 180; pts.push((120 + r * Math.cos(a)).toFixed(1) + ',' + (120 + r * Math.sin(a)).toFixed(1)); }
    return pts.join(' ');
  }
  function flat(name, shapeFn, maxW, sz, rot, extra, cy) {
    return { name: name, draw: function (p, id) {
      var fx = p.fx !== false, body;
      if (fx) {
        body = '<g transform="translate(4 9)" opacity=".2">' + shapeFn('#000') + '</g>' +
          '<linearGradient id="' + id + 'f" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="230"><stop offset="0" stop-color="' + lighten(p.c1, .16) + '"/><stop offset="1" stop-color="' + darken(p.c1, .2) + '"/></linearGradient>' +
          shapeFn('url(#' + id + 'f)') +
          '<mask id="' + id + 'c" maskUnits="userSpaceOnUse" x="0" y="0" width="248" height="252">' + shapeFn('#fff') + '</mask>' +
          '<ellipse cx="104" cy="52" rx="82" ry="46" fill="#fff" opacity=".2" mask="url(#' + id + 'c)"/>';
      } else body = shapeFn(p.c1);
      return { w: 248, h: 252, body: '<g>' + body + (extra ? extra(p) : '') + '</g>' + textBlock(p, 120, cy || 121, maxW, sz, rot) };
    } };
  }
  function rpoly(n, R, off) {
    var a = [];
    for (var i = 0; i < n; i++) { var t = (off + i * 360 / n) * Math.PI / 180; a.push((120 + R * Math.cos(t)).toFixed(1) + ',' + (120 + R * Math.sin(t)).toFixed(1)); }
    return a.join(' ');
  }
  TPL.squircle = flat('마름모 라운드 (플랫)', function (f) {
    return '<rect x="40" y="40" width="160" height="160" rx="46" transform="rotate(45 120 120)" fill="' + f + '"/>';
  }, 106, [22, 50, 20]);
  TPL.orgblob = flat('유기적 블롭 (플랫)', function (f) {
    return '<path d="' + polarPath(function (t) { return 93 + 9 * Math.cos(2 * t + 0.6) + 6 * Math.cos(3 * t + 1.7) + 4 * Math.cos(5 * t); }) + '" fill="' + f + '"/>';
  }, 132, [24, 62, 22]);
  TPL.octa = flat('팔각형 (플랫)', function (f) {
    return '<polygon points="' + rpoly(8, 100, 22.5) + '" fill="' + f + '" stroke="' + f + '" stroke-width="14" stroke-linejoin="round"/>';
  }, 140, [24, 60, 22], 0, function (p) {
    return '<polygon points="' + rpoly(8, 84, 22.5) + '" fill="none" stroke="' + p.c2 + '" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"/>';
  });
  TPL.drop = flat('물방울·불꽃 (플랫)', function (f) {
    return '<path d="M120 12 C148 56 206 92 206 152 A86 86 0 0 1 34 152 C34 92 92 56 120 12 Z" fill="' + f + '"/>';
  }, 112, [22, 56, 20], 0, null, 148);
  TPL.ring = flat('이중 링 원형 (플랫)', function (f) {
    return '<circle cx="120" cy="120" r="108" fill="' + f + '"/>';
  }, 134, [24, 60, 22], 0, function (p) {
    return '<circle cx="120" cy="120" r="95" fill="none" stroke="' + p.c2 + '" stroke-opacity=".75" stroke-width="3"/>' +
      '<circle cx="120" cy="120" r="86" fill="none" stroke="' + p.c2 + '" stroke-opacity=".55" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>';
  });
  TPL.hexf = flat('라운드 육각 (플랫)', function (f) {
    return '<polygon points="' + rpoly(6, 98, -90) + '" fill="' + f + '" stroke="' + f + '" stroke-width="16" stroke-linejoin="round"/>';
  }, 128, [24, 58, 22]);

  /* ---------- 정사각형 3종 ---------- */
  TPL.sqframe = flat('정사각 이중 테두리', function (f) {
    return '<rect x="18" y="18" width="204" height="204" rx="34" fill="' + f + '"/>';
  }, 140, [24, 60, 22], 0, function (p) {
    return '<rect x="34" y="34" width="172" height="172" rx="22" fill="none" stroke="' + p.c2 + '" stroke-opacity=".8" stroke-width="3"/>';
  });
  TPL.sqnotch = flat('쿠폰형 정사각 (홈)', function (f) {
    return '<path d="M34 20 H106 A14 14 0 0 0 134 20 H206 Q220 20 220 34 V106 A14 14 0 0 0 220 134 V206 Q220 220 206 220 H134 A14 14 0 0 0 106 220 H34 Q20 220 20 206 V134 A14 14 0 0 0 20 106 V34 Q20 20 34 20 Z" fill="' + f + '"/>';
  }, 150, [24, 60, 22], 0, function (p) {
    return '<rect x="36" y="36" width="168" height="168" rx="14" fill="none" stroke="' + p.c2 + '" stroke-opacity=".6" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>';
  });
  TPL.sqcut = flat('모서리 컷 정사각', function (f) {
    return '<polygon points="52,22 220,22 220,170 170,220 22,220 22,72" fill="' + f + '" stroke="' + f + '" stroke-width="8" stroke-linejoin="round"/>';
  }, 140, [24, 60, 22], 0, function (p) {
    return '<polyline points="46,60 46,46 60,46" fill="none" stroke="' + p.c2 + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<polyline points="194,180 194,194 180,194" fill="none" stroke="' + p.c2 + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
  });

  /* ---------- 원형 3종 ---------- */
  TPL.circoin = flat('코인형 원 (이중 링)', function (f) {
    return '<circle cx="120" cy="120" r="108" fill="' + f + '"/>';
  }, 136, [24, 62, 22], 0, function (p) {
    return '<circle cx="120" cy="120" r="94" fill="none" stroke="' + p.c2 + '" stroke-width="6"/>' +
      '<circle cx="120" cy="120" r="82" fill="none" stroke="' + p.c2 + '" stroke-opacity=".45" stroke-width="1.5"/>';
  });
  TPL.cirrays = flat('광채 원 (눈금 링)', function (f) {
    return '<circle cx="120" cy="120" r="108" fill="' + f + '"/>';
  }, 126, [22, 58, 20], 0, function (p) {
    var a = '';
    for (var i = 0; i < 36; i++) {
      var t = i * 10 * Math.PI / 180, r1 = 86, r2 = (i % 3 === 0) ? 100 : 94;
      a += '<line x1="' + (120 + r1 * Math.cos(t)).toFixed(1) + '" y1="' + (120 + r1 * Math.sin(t)).toFixed(1) + '" x2="' + (120 + r2 * Math.cos(t)).toFixed(1) + '" y2="' + (120 + r2 * Math.sin(t)).toFixed(1) + '" stroke="' + p.c2 + '" stroke-opacity=".85" stroke-width="3" stroke-linecap="round"/>';
    }
    return a;
  });
  TPL.cirband = flat('하단 띠 원', function (f) {
    return '<circle cx="120" cy="120" r="108" fill="' + f + '"/>';
  }, 134, [24, 60, 22], 0, function (p) {
    return '<path d="M30.2 178 A108 108 0 0 0 209.8 178 Z" fill="#000" fill-opacity=".18"/>' +
      '<path d="M30.2 178 H209.8" stroke="' + p.c2 + '" stroke-opacity=".7" stroke-width="3"/>';
  }, 108);

  /* ---------- 가로 텍스트바 3종 ---------- */
  TPL.textbar = { name: '가로 텍스트바 (둥근)', draw: function (p, id) {
    return { w: 340, h: 132, body:
      '<rect x="14" y="30" width="320" height="88" rx="44" transform="translate(3 7)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="10" y="26" width="320" height="88" rx="44" fill="url(#' + id + 'g)"/>' +
      '<rect x="17" y="33" width="306" height="74" rx="37" fill="url(#' + id + 'b)"/>' +
      '<rect x="24" y="40" width="292" height="30" rx="15" fill="#fff" opacity=".14"/>' +
      textBlock(p, 170, 70, 270, [22, 46, 20]) };
  } };
  TPL.textbar_slant = { name: '가로 텍스트바 (사선 끝)', draw: function (p, id) {
    var pts = '34,30 330,30 306,116 10,116';
    return { w: 340, h: 132, body:
      '<polygon points="' + pts + '" transform="translate(3 7)" fill="' + SH + '" opacity=".2"/>' +
      '<polygon points="' + pts + '" fill="url(#' + id + 'g)" stroke="url(#' + id + 'g)" stroke-width="6" stroke-linejoin="round"/>' +
      '<polygon points="41,37 323,37 302,109 17,109" fill="url(#' + id + 'b)"/>' +
      '<polygon points="41,37 323,37 316,52 34,52" fill="#fff" opacity=".14"/>' +
      textBlock(p, 170, 73, 260, [22, 46, 20]) };
  } };
  TPL.textbar_stripe = { name: '가로 텍스트바 (줄무늬)', draw: function (p, id) {
    return { w: 340, h: 132, body:
      '<rect x="14" y="30" width="320" height="88" rx="12" transform="translate(3 7)" fill="' + SH + '" opacity=".2"/>' +
      '<rect x="10" y="26" width="320" height="88" rx="12" fill="url(#' + id + 'g)"/>' +
      '<rect x="18" y="34" width="304" height="72" rx="6" fill="url(#' + id + 'b)"/>' +
      '<rect x="18" y="38" width="304" height="3" fill="' + p.c2 + '" opacity=".75"/>' +
      '<rect x="18" y="99" width="304" height="3" fill="' + p.c2 + '" opacity=".75"/>' +
      textBlock(p, 170, 70, 270, [22, 46, 20]) };
  } };

  /* ---------- SVG 조립 ---------- */
  function defs(p, id) {
    return '<defs>' +
      '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + lighten(p.c1, .16) + '"/><stop offset="1" stop-color="' + darken(p.c1, .2) + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + lighten(p.c2, .55) + '"/><stop offset=".5" stop-color="' + p.c2 + '"/><stop offset="1" stop-color="' + darken(p.c2, .28) + '"/></linearGradient>' +
      '</defs>';
  }
  function build(p, o) {
    o = o || {};
    var id = o.id || 'b', t = TPL[p.tpl] || TPL.shield, r = t.draw(p, id);
    var label = [p.small, String(p.main || '').replace(/\n/g, ' '), p.sub].filter(Boolean).join(' ');
    var sc = o.scale || 1;
    var style = o.fontCss ? '<style>' + o.fontCss + '</style>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(r.w * sc) + '" height="' + Math.round(r.h * sc) + '" viewBox="0 0 ' + r.w + ' ' + r.h + '" role="img" aria-label="' + esc(label) + '">' +
      '<title>' + esc(label) + '</title>' + style + defs(p, id) + r.body + '</svg>';
  }

  /* ---------- 기본 9종 ---------- */
  function D(tpl, small, main, sub, c1, c2, tc) { return { tpl: tpl, small: small, main: main, sub: sub, c1: c1, c2: c2, tc: tc || '#FFFFFF', scale: 1 }; }
  var DEFAULTS = [
    { key: 'new',           v: D('tagprice', '', 'NEW',      '', '#F54A66', '#FFFFFF') },
    { key: 'best',          v: D('blob',   '', 'BEST',       '', NAVY, GOLD) },
    { key: 'hot',           v: D('burst',  '', 'HOT',        '', '#FF4B1F', '#FFC21F') },
    { key: 'free-shipping', v: D('frame',  '', '무료배송',    '· FREE ·', NAVY, GOLD) },
    { key: 'coming-soon',   v: D('ribbon2', '', '입고예정',  '', '#5B6578', '#FFFFFF') },
    { key: 'beginner-pick', v: D('shield', '입문자', '추천', '', NAVY, GOLD) },
    { key: 'new-arrival',   v: D('banner',  '', '신상\n입고', '', '#7B3CF2', '#FFFFFF') },
    { key: 'manager-pick',  v: D('medal',  '매니저', 'PICK', '', NAVY, GOLD) },
    { key: 'rank-1',        v: D('laurel', '예약', '1위',    '', NAVY, GOLD) },
    { key: 'manager-pick-check',      v: D('checkseal', '매니저', 'PICK',        '', NAVY, GOLD) },
    { key: 'manager-pick-check-pill', v: D('checkpill', '',      '매니저 PICK', '', NAVY, GOLD) },
    { key: 'flat-free-shipping', v: D('squircle', '', '무료\n배송', '', '#4E8CA4', '#FFFFFF') },
    { key: 'flat-best',          v: D('orgblob',  '', 'BEST',      '', '#F2685C', '#FFFFFF') },
    { key: 'flat-new',           v: D('octa',     '', 'NEW',       '', '#17BFCB', '#FFFFFF') },
    { key: 'flat-hot',           v: D('drop',     '', 'HOT',       '', '#FFA62B', '#FFFFFF') },
    { key: 'flat-manager-pick',  v: D('ring',     '매니저', 'PICK', '', '#F2685C', '#FFFFFF') },
    { key: 'flat-rank-1',        v: D('hexf',     '예약', '1위',    '', '#F07C9F', '#FFFFFF') },
    { key: 'sq-hot',     v: D('sqframe', '', 'HOT',      '', '#FF5A3C', '#FFFFFF') },
    { key: 'sq-coupon',  v: D('sqnotch', '', '입고\n예정', '', '#5B6578', '#FFFFFF') },
    { key: 'sq-rank-1',  v: D('sqcut',   '예약', '1위',   '', '#7B3CF2', '#FFFFFF') },
    { key: 'circle-best', v: D('circoin', '', 'BEST',     '', NAVY, GOLD) },
    { key: 'circle-new',  v: D('cirrays', '', 'NEW',      '', '#1FAE7C', '#FFFFFF') },
    { key: 'circle-manager-pick', v: D('cirband', '매니저', 'PICK', '', '#2F6FED', '#FFFFFF') },
    { key: 'bar-event',  v: D('textbar', '', '무료배송 이벤트', '', '#F54A66', '#FFFFFF') },
    { key: 'bar-stock',  v: D('textbar_slant', '', '매주 신상 입고', '', NAVY, GOLD) },
    { key: 'bar-notice', v: D('textbar_stripe', '', '예약 마감 임박', '', '#5B6578', '#FFFFFF') }
  ];

  return { TPL: TPL, build: build, DEFAULTS: DEFAULTS, FONT: FONT };
})();
