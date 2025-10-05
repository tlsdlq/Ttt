// 유틸리티
function getTextWidth(text, fontSize = 15) {
  let width = 0;
  if (!text) return 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char)) { width += fontSize; }
    else if (/[A-Z]/.test(char)) { width += fontSize * 0.75; }
    else if (/[a-z0-9]/.test(char)) { width += fontSize * 0.55; }
    else if (/\s/.test(char)) { width += fontSize * 0.3; }
    else if (/[?!.,]/.test(char)) { width += fontSize * 0.3; }
    else if (/[□■]/.test(char)) { width += fontSize * 1.2; }
    else { width += fontSize * 0.5; }
  }
  return width;
}
function wrapText(text, maxWidth, fontSize = 15) { if (!text) return [' ']; const words = text.split(' '); const lines = []; let currentLine = words[0] || ''; for (let i = 1; i < words.length; i++) { const word = words[i]; const testLine = currentLine + ' ' + word; if (getTextWidth(testLine, fontSize) < maxWidth) { currentLine = testLine; } else { lines.push(currentLine); currentLine = word; } } lines.push(currentLine); return lines; }
function escapeHtml(unsafe) { if (!unsafe) return ''; return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

// 설정
const IMAGE_KEYWORDS = {
    '랜덤': 'https://picsum.photos/900/300',
    '주의': 'https://i.imgur.com/dJ8vU52.png',
    '하트': 'https://i.imgur.com/bY2a3y4.png',
};

const SPECIAL_CHAR_SOURCES = {
    '■': 'https://ibb.co/zhtLWyBs', 
    '□': 'https://ibb.co/QvLhmL22', 
};

// 이미지 처리
async function getImageDataUri(url) {
  if (url.startsWith('data:image')) {
    return url;
  }
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
    console.error(`Failed to fetch image data for ${url}:`, error);
    return null;
  }
}

// 핸들러
export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    let response = await cache.match(request);
    if (response) { return response; }

    const processedSpecialCharImages = {};
    const specialCharPromises = Object.entries(SPECIAL_CHAR_SOURCES).map(async ([char, url]) => {
        const dataUri = await getImageDataUri(url);
        if (dataUri) {
            processedSpecialCharImages[char] = dataUri;
        }
    });
    await Promise.all(specialCharPromises);


    const { searchParams } = new URL(request.url);
    const postData = searchParams.get('글') || '제목|작성자|0|0|0|내용이 없습니다.';
    let title, author, views, upvotes, dislikes, content;
    try {
      const parts = postData.split('|');
      title = decodeURIComponent(parts[0] || '').replace(/\//g, ' ');
      author = decodeURIComponent(parts[1] || '').replace(/\//g, ' ');
      views = parts[2]; upvotes = parts[3]; dislikes = parts[4];
      content = decodeURIComponent(parts[5] || '').replace(/\//g, ' ');
    } catch (e) {
      [title, author, views, upvotes, dislikes, content] = ['파싱 오류', '시스템', '0', '0', '0', 'URL의 글 파라미터 형식이 올바르지 않습니다.'];
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
        const textWithNewlines = text.replace(/\《img:(.+?)\》/g, '\n《img:$1》\n');
        const imgTagRegex = /\《img:(.+?)\》/g;
        const parts = textWithNewlines.split(imgTagRegex);

        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) {
                if (parts[i]) {
                    parts[i].split('\n').forEach(line => {
                        if (line) {
                           processed.push({ type: 'text', text: line });
                        }
                    });
                }
            } else {
                const keyword = parts[i].trim();
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
    const IMAGE_MARGIN_BOTTOM = 10;

    const calculateProcessedHeight = (processedItems, maxWidth, fontSize, lineHeight) => {
        let height = 0;
        processedItems.forEach(item => {
            if (item.type === 'image') { height += IMAGE_HEIGHT + IMAGE_MARGIN_BOTTOM; }
            else { height += wrapText(item.text, maxWidth, fontSize).length * lineHeight; }
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
    
    let svg = `<svg width="780" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><style>.font { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; } .title { font-size: 20px; font-weight: 500; } .meta { font-size: 13px; } .content { font-size: 15px; fill: ${theme.contentText}; } .comment-author { font-size: 14px; font-weight: bold; fill: #111; } .comment-content { font-size: 14px; fill: #333; } .button-text { font-size: 14px; fill: ${theme.buttonText}; text-anchor: middle; }</style><rect width="100%" height="100%" fill="${theme.bg}" /><rect width="100%" height="100" fill="${theme.headerBlue}" /><g transform="translate(20, 0)">`;
    let titleX = 0;
    if (netUpvotes >= 20) {
        svg += `<text x="${titleX}" y="45" fill="${theme.star}" style="font-size:20px; font-weight:bold;">★</text>`; titleX += 25;
    }
    svg += `<text x="${titleX}" y="45" class="font title" fill="${theme.headerText}">${escapeHtml(title)}</text>`;
    svg += `<text y="75" class="font meta" fill="${theme.metaText}"><tspan style="font-weight:500; fill:${theme.headerText};">${escapeHtml(author)}</tspan><tspan dx="15">조회 ${views || 0}</tspan><tspan dx="10">추천 ${netUpvotes}</tspan></text></g>`;
    
    const renderTextWithInlineImages = (line, y, className, fontSize, xPos = 0) => {
        let lineSvg = `<text y="${y}" class="font ${className}">`;
        const specialChars = Object.keys(processedSpecialCharImages).join('');
        if (!specialChars) { 
            return `<text x="${xPos}" y="${y}" class="font ${className}">${escapeHtml(line)}</text>`;
        }
        
        const regex = new RegExp(`([${specialChars}])`, 'g');
        const parts = line.split(regex);
        let currentX = xPos;

        parts.forEach(part => {
            if (processedSpecialCharImages[part]) {
                const imgSize = fontSize * 1.1;
                lineSvg += `</text><image xlink:href="${processedSpecialCharImages[part]}" x="${currentX}" y="${y - imgSize + (fontSize * 0.2)}" width="${imgSize}" height="${imgSize}" /><text y="${y}" class="font ${className}">`;
                currentX += getTextWidth(part, fontSize);
            } else {
                const escapedPart = escapeHtml(part);
                lineSvg += `<tspan x="${currentX}">${escapedPart}</tspan>`;
                currentX += getTextWidth(part, fontSize);
            }
        });
        lineSvg += `</text>`;
        return lineSvg.replace(/<tspan x="0"><\/tspan>|<tspan x="(\d+)"><\/tspan>/g, '');
    };

    let currentY = 130;

    for (const item of processedContent) {
        if (item.type === 'image') {
            svg += `<g transform="translate(20, 0)"><image xlink:href="${item.uri}" x="0" y="${currentY}" height="${imageHeight}" width="740" preserveAspectRatio="xMidYMid meet" /></g>`;
            currentY += IMAGE_HEIGHT + IMAGE_MARGIN_BOTTOM;
        } else {
            const wrappedLines = wrapText(item.text, 740, 15);
            for (const line of wrappedLines) {
                svg += `<g transform="translate(20, 0)">${renderTextWithInlineImages(line, currentY, 'content', 15)}</g>`;
                currentY += 25;
            }
        }
    }

    const renderCommentsRecursive = (comments, depth) => {
        let subSvg = '';
        for (const comment of comments) {
            const xOffset = depth * 30;
            const authorY = currentY;
            subSvg += `<g transform="translate(${20 + xOffset}, 0)">`;
            if (depth > 0) { subSvg += `<text x="-18" y="${authorY}" style="font-size:16px; fill:#888;">↳</text>`; }
            subSvg += renderTextWithInlineImages(comment.author, authorY, 'comment-author', 14);
            subSvg += `</g>`;
            currentY += 22;

            for (const item of comment.processedContent) {
                if (item.type === 'image') {
                    subSvg += `<g transform="translate(${20 + xOffset}, 0)"><image xlink:href="${item.uri}" x="0" y="${currentY}" height="${IMAGE_HEIGHT}" width="${740 - xOffset}" preserveAspectRatio="xMidYMid meet" /></g>`;
                    currentY += IMAGE_HEIGHT + IMAGE_MARGIN_BOTTOM;
                } else {
                    const maxWidth = 740 - xOffset;
                    const wrappedLines = wrapText(item.text, maxWidth, 14);
                    for (const line of wrappedLines) {
                        subSvg += `<g transform="translate(${20 + xOffset}, 0)">${renderTextWithInlineImages(line, currentY, 'comment-content', 14)}</g>`;
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

    response = new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' }});
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
