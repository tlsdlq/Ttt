// 망할!!! 왜!!! 글마다 크기가 다른가요!!?!?!?
function getTextWidth(text, fontSize = 15) {
  let width = 0;
  if (!text) return 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char)) { width += fontSize; }
    else if (/[□■]/.test(char)) { width += fontSize; }
    else if (/[A-Z]/.test(char)) { width += fontSize * 0.75; }
    else if (/[a-z0-9]/.test(char)) { width += fontSize * 0.55; }
    else if (/\s/.test(char)) { width += fontSize * 0.3; }
    else if (/[?!.,]/.test(char)) { width += fontSize * 0.3; }
    else { width += fontSize * 0.5; }
  }
  return width;
}
function wrapText(text, maxWidth, fontSize = 15) { if (!text) return [' ']; const words = text.split(' '); const lines = []; let currentLine = words[0] || ''; for (let i = 1; i < words.length; i++) { const word = words[i]; const testLine = currentLine + ' ' + word; if (getTextWidth(testLine, fontSize) < maxWidth) { currentLine = testLine; } else { lines.push(currentLine); currentLine = word; } } lines.push(currentLine); return lines; }
// 망할! 왜! HTML도 막아야!! 으아아!
function escapeHtml(unsafe) { if (!unsafe) return ''; return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "\"").replace(/'/g, "'"); }


// ■■■■■■■■■■■■■■■■■■설정■■■■■■■■■■■■■■■■■■

const IMAGE_KEYWORDS = {
    '랜덤': 'https://picsum.photos/900/300',
    '주의': 'https://i.imgur.com/dJ8vU52.png',
    '하트': 'https://i.imgur.com/bY2a3y4.png',
};

const INLINE_IMAGES = {
  '□': 'https://picsum.photos/900/300', 
  '■': 'https://i.ibb.co/zhtLWyBs/3d0ce56134aa5e30fc03c7f707d14978340abc683e0cb5b004f17ae577a667be.webp'
};

// ■■■■■■■■■■■■■■■■■■설정■■■■■■■■■■■■■■■■■■



async function getImageDataUri(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/png';
    
    const buffer = await response.arrayBuffer();

    const base64 = ((arr) => {
        let a = "", b, c, d, e, f, g, i = 0;
        const h = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        do { b = arr[i++]; c = arr[i++]; d = arr[i++]; e = b >> 2; f = (b & 3) << 4 | c >> 4; g = (c & 15) << 2 | d >> 6; a += h.charAt(e) + h.charAt(f) + h.charAt(g) + h.charAt(d & 63); } while (i < arr.length);
        if (isNaN(c)) { a = a.slice(0, -2) + "=="; } else if (isNaN(d)) { a = a.slice(0, -1) + "="; }
        return a;
    })(new Uint8Array(buffer));

    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error(`Failed to get image data URI for ${url}:`, error);
    return null;
  }
}


// 핸들러

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    let response = await cache.match(request);
    if (response) { return response; }

    const inlineImageDataUris = new Map();
    const inlineImagePromises = Object.entries(INLINE_IMAGES).map(async ([key, url]) => {
        const dataUri = await getImageDataUri(url);
        if (dataUri) inlineImageDataUris.set(key, dataUri);
    });
    await Promise.all(inlineImagePromises);

    const { searchParams } = new URL(request.url);
    const postData = searchParams.get('글') || '제목|작성자|0|0|0|내용이없다.';
    let title, author, views, upvotes, dislikes, content;
    try {
      const parts = postData.split('|');
      title = decodeURIComponent(parts[0] || '').replace(/\//g, ' ');
      author = decodeURIComponent(parts[1] || '').replace(/\//g, ' ');
      views = parts[2]; upvotes = parts[3]; dislikes = parts[4];
      content = decodeURIComponent(parts[5] || '').replace(/\//g, ' ');
    } catch (e) {
      [title, author, views, upvotes, dislikes, content] = ['오류', '시스템', '0', '0', '0', '파라미터 형식이 올바르지 않다.'];
    }

    const commentsMap = new Map();
    const rootComments = [];
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('댓글')) {
        try {
          const commentParts = value.split('|');
          const type = decodeURIComponent(commentParts[0] || '');
          const comAuthor = decodeURIComponent(commentParts[1] || '').replace(/\//g, ' ');
          const comContent = decodeURIComponent(commentParts[2] || '').replace(/\//g, ' ');
          const commentData = { id: key, author: comAuthor, content: comContent, children: [], processedContent: [] };
          if (type.startsWith('대')) {
            const parentId = type.substring(1);
            if (commentsMap.has(parentId)) { commentsMap.get(parentId).children.push(commentData); }
          } else { rootComments.push(commentData); }
          commentsMap.set(key, commentData);
        } catch (e) {}
      }
    }
    
    const processContent = async (text) => {
        const processed = [];
        if (!text) return processed;
        const imgTagRegex = /\[(.+?)\]/g;
        const parts = text.split(imgTagRegex);
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) {
                if (parts[i]) {
                    parts[i].split('\n').forEach((line, index, arr) => {
                        if (line || arr.length > 1) {
                            processed.push({ type: 'text', text: line });
                        }
                    });
                }
            } else {
                const keyword = parts[i];
                const imageUrl = IMAGE_KEYWORDS[keyword];
                if (imageUrl) {
                    const dataUri = await getImageDataUri(imageUrl);
                    if (dataUri) {
                        processed.push({ type: 'image', uri: dataUri });
                    }
                } else {
                    processed.push({ type: 'text', text: `{img:${keyword}}` });
                }
            }
        }
        return processed;
    };
    
    const processedContent = await processContent(content);
    const processCommentsRecursive = async (comments) => {
        for (const comment of comments) {
            comment.processedContent = await processContent(comment.content);
            await processCommentsRecursive(comment.children);
        }
    };
    await processCommentsRecursive(rootComments);

    const IMAGE_HEIGHT = 200;
    const IMAGE_TOP_MARGIN = 15;
    const IMAGE_BOTTOM_MARGIN = 10;

    const calculateProcessedHeight = (processedItems, maxWidth, fontSize, lineHeight) => {
        let height = 0;
        processedItems.forEach(item => {
            if (item.type === 'image') {
                height += IMAGE_TOP_MARGIN + IMAGE_HEIGHT + IMAGE_BOTTOM_MARGIN;
            }
            else {
                const textToWrap = item.text || ' ';
                height += wrapText(textToWrap, maxWidth, fontSize).length * lineHeight;
            }
        });
        return height;
    };

    const calculateCommentsHeight = (comments, depth) => {
        let height = 0;
        for (const comment of comments) {
            height += 30;
            const maxWidth = 740 - (depth * 30);
            height += calculateProcessedHeight(comment.processedContent, maxWidth, 14, 22);
            height += 8;
            height += calculateCommentsHeight(comment.children, depth + 1);
        }
        return height;
    };

    let dynamicHeight = calculateProcessedHeight(processedContent, 740, 15, 25);
    if (rootComments.length > 0) {
        dynamicHeight += 60;
        dynamicHeight += calculateCommentsHeight(rootComments, 0);
    }
    const imageHeight = 120 + dynamicHeight + 80;

    const netUpvotes = (parseInt(upvotes) || 0) - (parseInt(dislikes) || 0);
    const theme = { bg: '#ffffff', border: '#e3e3e3', headerBlue: '#5c6bc0', headerText: '#ffffff', metaText: '#eeeeee', contentText: '#333', buttonBg: '#f8f8f8', buttonText: '#555', star: '#ffc107', commentHeader: '#666' };

    const renderTextWithInlineImages = (text, x, y, fontSize, attributes = '') => {
        let svg = '';
        let currentX = x;
        const parts = text.split(/([□■])/g).filter(Boolean);
        for (const part of parts) {
            if (inlineImageDataUris.has(part)) {
                const dataUri = inlineImageDataUris.get(part);
                svg += `<image href="${dataUri}" x="${currentX}" y="${y - fontSize * 0.8}" width="${fontSize}" height="${fontSize}"/>`;
                currentX += fontSize;
            } else {
                svg += `<text x="${currentX}" y="${y}" ${attributes}>${escapeHtml(part)}</text>`;
                currentX += getTextWidth(part, fontSize);
            }
        }
        return { svg, finalX: currentX };
    };
    
    let svg = `<svg width="780" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg"><style>.font { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; } .title { font-size: 20px; font-weight: 500; } .meta { font-size: 13px; } .content { font-size: 15px; fill: ${theme.contentText}; } .comment-author { font-size: 14px; font-weight: bold; fill: #111; } .comment-content { font-size: 14px; fill: #333; } .button-text { font-size: 14px; fill: ${theme.buttonText}; text-anchor: middle; }</style><rect width="100%" height="100%" fill="${theme.bg}" /><rect width="100%" height="100" fill="${theme.headerBlue}" /><g transform="translate(20, 0)">`;
    
    let currentX = 0;
    if (netUpvotes >= 20) {
        svg += `<text x="${currentX}" y="45" fill="${theme.star}" style="font-size:20px; font-weight:bold;">★</text>`; currentX += 25;
    }
    svg += renderTextWithInlineImages(title, currentX, 45, 20, `class="font title" fill="${theme.headerText}"`).svg;

    let metaX = 0;
    const authorResult = renderTextWithInlineImages(author, metaX, 75, 13, `style="font-weight:500; fill:${theme.headerText};" class="font meta"`);
    svg += authorResult.svg;
    metaX = authorResult.finalX;
    
    metaX += 15;
    svg += `<text x="${metaX}" y="75" class="font meta" fill="${theme.metaText}">조회 ${views || 0}</text>`;
    metaX += getTextWidth(`조회 ${views || 0}`, 13);

    metaX += 10;
    svg += `<text x="${metaX}" y="75" class="font meta" fill="${theme.metaText}">추천 ${netUpvotes}</text>`;
    svg += `</g>`;
    
    let currentY = 130;

    svg += `<g transform="translate(20, 0)">`;
    for (const item of processedContent) {
        if (item.type === 'image') {
            currentY += IMAGE_TOP_MARGIN;
            svg += `<image href="${item.uri}" x="0" y="${currentY}" height="${IMAGE_HEIGHT}" width="740" preserveAspectRatio="xMidYMid meet" />`;
            currentY += IMAGE_HEIGHT + IMAGE_BOTTOM_MARGIN; // [수정] 이미지 높이와 아래쪽 여백을 더함(진짜... 좀 들으세요... 코드님...)
        } else {
            const textToWrap = item.text || ' ';
            const wrappedLines = wrapText(textToWrap, 740, 15);
            for (const line of wrappedLines) {
                svg += renderTextWithInlineImages(line, 0, currentY, 15, `class="font content"`).svg;
                currentY += 25;
            }
        }
    }
    svg += `</g>`;

    const renderCommentsRecursive = (comments, depth) => {
        let subSvg = '';
        for (const comment of comments) {
            const xOffset = depth * 30;
            subSvg += `<g transform="translate(${20 + xOffset}, ${currentY})">`;
            if (depth > 0) { subSvg += `<text x="-18" y="0" style="font-size:16px; fill:#888;">↳</text>`; }
            subSvg += renderTextWithInlineImages(comment.author, 0, 0, 14, `class="font comment-author"`).svg;
            subSvg += `</g>`;
            currentY += 22;

            for (const item of comment.processedContent) {
                if (item.type === 'image') {
                    currentY += IMAGE_TOP_MARGIN;
                    subSvg += `<image href="${item.uri}" x="${20 + xOffset}" y="${currentY}" height="${IMAGE_HEIGHT}" width="${740 - xOffset}" preserveAspectRatio="xMidYMid meet" />`;
                    currentY += IMAGE_HEIGHT + IMAGE_BOTTOM_MARGIN;
                } else {
                    const textToWrap = item.text || ' ';
                    const maxWidth = 740 - xOffset;
                    const wrappedLines = wrapText(textToWrap, maxWidth, 14);
                    for (const line of wrappedLines) {
                        subSvg += `<g transform="translate(${20 + xOffset}, 0)">`;
                        subSvg += renderTextWithInlineImages(line, 0, currentY, 14, `class="font comment-content"`).svg;
                        subSvg += `</g>`;
                        currentY += 22;
                    }
                }
            }
            currentY += 8;
            subSvg += renderCommentsRecursive(comment.children, depth + 1);
        }
        return subSvg;
    };
    
    if (rootComments.length > 0) {
      currentY += 20;
      svg += `<g transform="translate(20, ${currentY})"><line x1="0" y1="-20" x2="740" y2="-20" stroke="${theme.border}" /><text y="5" style="font-size:15px; font-weight:bold; fill:${theme.commentHeader};">댓글 ${commentsMap.size}개</text></g>`;
      currentY += 40;
      svg += renderCommentsRecursive(rootComments, 0);
    }

    svg += `<g transform="translate(0, ${imageHeight - 70})"><line x1="0" y1="0" x2="780" y2="0" stroke="${theme.border}" /><g transform="translate(260, 20)"><rect width="120" height="35" rx="5" ry="5" fill="${theme.buttonBg}" stroke="${theme.border}" /><text x="60" y="23" class="font button-text">[추천! ${upvotes || 0}]</text></g><g transform="translate(400, 20)"><rect width="120" height="35" rx="5" ry="5" fill="${theme.buttonBg}" stroke="${theme.border}" /><text x="60" y="23" class="font button-text">[비추천! ${dislikes || 0}]</text></g></g></svg>`;

    response = new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' }}); // 캐싱인데... 개인 도메인 없으면 쓸모가 거의 없다니!
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
