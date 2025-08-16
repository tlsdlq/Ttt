import { Buffer } from 'node:buffer';

const CACHE_VER = 'v1';
const ALLOWED_HOSTS = ['unsplash.com', 'i.imgur.com', 'raw.githubusercontent.com', 'itimg.kr'];
const MAX_SIZE = 10 * 1024 * 1024;
const DEF_WIDTH = 1200;
const DEF_HEIGHT = 630;
const PADDING = 40;
const FONT_RATIO = 0.04;
const LINE_HEIGHT = 1.4;
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default {
  async fetch(request, env, ctx) {
    // 이 fetch 함수는 Cloudflare 엣지 네트워크에 캐시가 없을 때,
    // 단 한 번만 실행됩니다.
    // 두 번째 요청부터는 이 코드는 아예 실행조차 되지 않습니다.
    try {
      const url = new URL(request.url);
      const params = url.searchParams;
      const imgUrl = params.get('img');
      const text = params.get('text');
      const name = params.get('name');

      if (imgUrl) {
        try {
          const urlObj = new URL(imgUrl);
          if (!['https:', 'http:'].includes(urlObj.protocol)) throw new Error('Invalid protocol');
          if (!ALLOWED_HOSTS.includes(urlObj.hostname)) throw new Error('Host not allowed');
        } catch (e) {
          return new Response(e.message === 'Host not allowed' ? 'Host not allowed.' : 'Invalid image URL.', { status: 400 });
        }
      }

      if (!imgUrl || !text) {
        // 사용법 안내 페이지는 캐시를 짧게 설정하거나 하지 않습니다.
        const usageImg = 'https://images.unsplash.com/photo-14844178942c8ee29?w=1200';
        const usageText = "Usage: ?img=<ALLOWED_URL>&text=<TEXT>&name=<NAME>";
        const image = { contentType: 'image/jpeg', base64: '' };
        const lines = wrap(usageText, DEF_WIDTH - PADDING * 2, DEF_HEIGHT * FONT_RATIO, TW);
        return createSvg({ width: DEF_WIDTH, height: DEF_HEIGHT, imageUrl: usageImg, image, lines, fontSize: DEF_HEIGHT * FONT_RATIO, name: "Example" }, false);
      }

      const { image, width, height } = await getImage(imgUrl, ctx);
      let fontSize = Math.max(20, height * FONT_RATIO);
      const availableWidth = width - PADDING * 2;
      let lines = wrap(text, availableWidth, fontSize, TW);
      const maxTextHeight = height * 0.45;
      const minFontSize = 16;

      while ((lines.length * fontSize * LINE_HEIGHT) > maxTextHeight && fontSize > minFontSize) {
        fontSize = Math.max(minFontSize, fontSize - 2);
        lines = wrap(text, availableWidth, fontSize, TW);
      }
      
      // 생성된 SVG 응답을 반환합니다. 이 응답에는 Cloudflare를 위한 '명령서'가 포함됩니다.
      return createSvg({ width, height, imageUrl: imgUrl, image, lines, fontSize, name }, true);

    } catch (error) {
      console.error('Image processing failed:', error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};

function createSvg({ width, height, imageUrl, image, lines, fontSize, name }, doCache) {
  const imgHref = image.base64 ? `data:${image.contentType};base64,${image.base64}` : esc(imageUrl);
  const boxHeight = (lines.length * fontSize * LINE_HEIGHT) + (PADDING * 1.5) + (name ? fontSize : 0);
  const boxY = height - boxHeight;
  let nameEl = '';
  if (name) {
    const nameFS = fontSize * 0.75;
    const nameBoxH = nameFS * 1.8;
    const nameTextW = name.length * nameFS * 0.6;
    const namePad = nameFS * 0.8;
    const p = [`0,${boxY}`, `${nameTextW + namePad * 2},${boxY}`, `${nameTextW + namePad * 2 + nameBoxH * 0.5},${boxY + nameBoxH}`, `0,${boxY + nameBoxH}`];
    nameEl = `<polygon points="${p.join(' ')}" fill="rgba(255,255,255,0.25)"/><text x="${namePad}" y="${boxY + nameBoxH / 2}" class="name" dominant-baseline="central">${esc(name)}</text>`;
  }
  const textOffsetY = name ? fontSize * 1.5 : PADDING * 0.5;
  const textElements = lines.map((line, i) => `<tspan x="${PADDING}" dy="${i === 0 ? '0' : `${LINE_HEIGHT}em`}">${esc(line)}</tspan>`).join('');
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><style>.txt{font-family:${FONT_FAMILY};font-size:${fontSize}px;fill:white;font-weight:600;}.name{font-family:${FONT_FAMILY};font-size:${fontSize * 0.75}px;fill:white;font-weight:700;}</style><image href="${imgHref}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/><rect y="${boxY}" width="100%" height="${boxHeight}" fill="rgba(0,0,0,0.6)"/>${nameEl}<text x="${PADDING}" y="${boxY + textOffsetY + fontSize}" class="txt">${textElements}</text></svg>`;
  
  const responseOptions = {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  };

  if (doCache) {
    // 이 부분이 Cloudflare 네트워크에 보내는 '명령서'입니다.
    responseOptions.headers['Cache-Control'] = 'public, max-age=2592000, immutable';
    // 이 cf 객체가 "나를 다시 실행시키지 마라"고 하는 핵심 명령입니다.
    responseOptions.cf = {
      cacheEverything: true,
      cacheTtl: 2592000
    };
  }

  return new Response(svg, responseOptions);
}

// 헬퍼 함수들은 이전과 동일합니다.
async function getImage(url, ctx) { const cache = caches.default; const normalizedUrl = new URL(url); normalizedUrl.searchParams.sort(); const cacheKey = normalizedUrl.toString() + `&v=${CACHE_VER}`; const cached = await cache.match(cacheKey); if (cached) return cached.json(); const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } }); if (!response.ok) throw new Error(`Fetch failed: ${response.status}`); const length = response.headers.get('Content-Length'); if (length && parseInt(length, 10) > MAX_SIZE) { throw new Error(`Image size exceeds ${MAX_SIZE / 1024 / 1024}MB`); } const contentType = response.headers.get('Content-Type'); if (!contentType?.startsWith('image/')) { throw new Error(`Invalid content type: '${contentType}'`); } const buffer = await response.arrayBuffer(); const image = { contentType, base64: Buffer.from(buffer).toString('base64') }; const view = new DataView(buffer); let dims = { width: DEF_WIDTH, height: DEF_HEIGHT }; try { if (view.getUint16(0, false) === 0xFFD8) { let offset = 2; while (offset < view.byteLength) { if (view.getUint16(offset, false) === 0xFFC0) { dims = { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) }; break; } offset += 2 + view.getUint16(offset + 2, false); } } else if (view.getUint32(0, false) === 0x89504E47) { dims = { width: view.getUint32(16, false), height: view.getUint32(20, false) }; } else if (view.getUint32(8, false) === 0x57454250) { const chunk = new TextDecoder().decode(view.subarray(12, 16)); if (chunk === 'VP8 ') { if ((view.getUint32(19, true) & 0x07) === 0) { dims = { width: view.getUint16(26, true) & 0x3FFF, height: view.getUint16(28, true) & 0x3FFF }; } } else if (chunk === 'VP8L') { const bits = view.getUint32(21, true); dims = { width: (bits & 0x3FFF) + 1, height: (((bits >> 14) & 0x3FFF)) + 1 }; } else if (chunk === 'VP8X') { dims = { width: view.getUint32(24, true) + 1, height: view.getUint32(28, true) + 1 }; } } } catch (e) { } const result = { image, width: dims.width, height: dims.height }; ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(result), { headers: { 'Cache-Control': 'public, max-age=2592000' } }))); return result; }
function TW(text, fontSize) { let total = 0; const wideChar = /[\u3000-\u9FFF\uAC00-\uD7AF]/; for (const char of text) { total += wideChar.test(char) ? fontSize : fontSize * 0.55; } return total; }
function wrap(text, maxWidth, fontSize, widthCalc) { const words = text.split(' '); const lines = []; if (!words.length) return []; let currentLine = words[0]; for (let i = 1; i < words.length; i++) { const word = words[i]; const potentialLine = `${currentLine} ${word}`; if (widthCalc(potentialLine, fontSize) < maxWidth) { currentLine = potentialLine; } else { lines.push(currentLine); currentLine = word; } } lines.push(currentLine); return lines; }
function esc(unsafe) { return unsafe.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c])); }
