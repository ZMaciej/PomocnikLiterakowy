class ShareImageGenerator {

    static #canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                    return;
                }
                reject(new Error('Nie udało się wygenerować obrazka PNG.'));
            }, 'image/png');
        });
    }

    static #loadShareImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    static #drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // Cross-platform helper: positions text so its visual top is at y,
    // regardless of how the platform implements textBaseline='top'.
    static #fillTextTop(ctx, text, x, y) {
        const savedBaseline = ctx.textBaseline;
        ctx.textBaseline = 'alphabetic';
        const ascent = ctx.measureText(text).actualBoundingBoxAscent;
        ctx.fillText(text, x, y + ascent);
        ctx.textBaseline = savedBaseline;
    }

    static #wrapToLines(ctx, text, maxWidth) {
        const segments = text.split(', ');
        const lines = [];
        let line = '';
        for (const seg of segments) {
            const candidate = line ? line + ', ' + seg : seg;
            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = seg;
            } else {
                line = candidate;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    static async generate(payload, options = {}) {
        const includeWords = Boolean(options.includeWords);

        const OUTLINE = 22;
        const PADDING = 33;
        const ROOT_W = 878;
        const FONT = 'Poppins, system-ui, "Segoe UI", sans-serif';
        const CONTENT_W = ROOT_W - 2 * PADDING;        // 812
        const ROOT_X = OUTLINE;
        const CONTENT_X = ROOT_X + PADDING;             // 55
        const CONTENT_CENTER_X = ROOT_X + ROOT_W / 2;  // 461

        // Ensure Poppins is loaded before drawing — it's already linked in index.html
        // so this resolves immediately if the font is cached, or waits up to 2s.
        try {
            await Promise.race([
                document.fonts.load('700 36px Poppins'),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (_) { /* fall back to system-ui */ }

        const penguinImageName = String(payload.score).includes('67')
            ? 'pingwin67.png'
            : 'pingwinDab.png';
        const penguinImg = await ShareImageGenerator.#loadShareImage(penguinImageName);

        const WORD_SIZE = 28;
        const LINE_H = 46;          // stride per text line
        const SEP = ', ';
        const WORD_TOP_MARGIN = 16;

        // Lays out tokens in a single comma-separated flow with greedy line-breaking.
        // Returns an array of placed token descriptors.
        function buildWordLayout(measureCtx) {
            const wordGroups = payload.wordGroups;
            if (!wordGroups || !wordGroups.length) return null;
            const tokens = [];
            wordGroups.forEach(group => {
                group.forEach(({ word, found }) => tokens.push({ word, found }));
            });
            if (!tokens.length) return null;

            measureCtx.font = `600 ${WORD_SIZE}px ${FONT}`;
            const SEP_W = measureCtx.measureText(SEP).width;

            const placed = [];
            let lineIdx = 0;
            let curX = CONTENT_X;
            let isFirstOnLine = true;

            for (let i = 0; i < tokens.length; i++) {
                const tok = tokens[i];
                const wordW = measureCtx.measureText(tok.word).width;
                const advance = isFirstOnLine ? 0 : SEP_W;

                // Wrap if this token does not fit on the current line.
                if (!isFirstOnLine && curX + advance + wordW > CONTENT_X + CONTENT_W) {
                    lineIdx++;
                    curX = CONTENT_X;
                    isFirstOnLine = true;
                }

                const drawSep = !isFirstOnLine;
                const sepX = drawSep ? curX : null;
                const wordX = curX + (isFirstOnLine ? 0 : advance);

                placed.push({ word: tok.word, found: tok.found,
                    lineIdx, wordX, wordW, drawSep, sepX });

                curX = wordX + wordW;
                isFirstOnLine = false;
            }

            return placed;
        }

        let wordSectionH = 0;
        let wordLayout = null;
        if (includeWords) {
            const tmpCtx = document.createElement('canvas').getContext('2d');
            wordLayout = buildWordLayout(tmpCtx);
            if (wordLayout && wordLayout.length) {
                const lineCount = wordLayout[wordLayout.length - 1].lineIdx + 1;
                wordSectionH = WORD_TOP_MARGIN + lineCount * LINE_H + 12;

                // Centre each line horizontally.
                // Find the rightmost x+w per line, compute offset, shift all tokens.
                const lineRight = new Map();
                for (const tok of wordLayout) {
                    const right = tok.wordX + tok.wordW;
                    if (!lineRight.has(tok.lineIdx) || right > lineRight.get(tok.lineIdx))
                        lineRight.set(tok.lineIdx, right);
                }
                for (const tok of wordLayout) {
                    const lineW = lineRight.get(tok.lineIdx) - CONTENT_X;
                    const offset = Math.round((CONTENT_W - lineW) / 2);
                    tok.wordX += offset;
                    if (tok.sepX !== null) tok.sepX += offset;
                }
            }
        }

        const TITLE_H = 65;
        const SUBTITLE_H = 36;
        const DATE_H = 30;
        const HEADER_H = TITLE_H + SUBTITLE_H + DATE_H;
        const HEADER_MB = 24;
        const CARD_H = 363;
        const CARD_MB = includeWords ? 24 : 0;

        const contentH = HEADER_H + HEADER_MB + CARD_H + CARD_MB + wordSectionH;
        const rootH = PADDING + contentH + PADDING;
        const canvasW = ROOT_W + 2 * OUTLINE;
        const canvasH = rootH + 2 * OUTLINE;

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');

        // peach outline background
        ctx.fillStyle = '#FEF1EB';
        ctx.fillRect(0, 0, canvasW, canvasH);

        // white root with rounded corners
        ctx.fillStyle = '#ffffff';
        ShareImageGenerator.#drawRoundedRect(ctx, ROOT_X, OUTLINE, ROOT_W, rootH, 12);
        ctx.fill();

        let y = OUTLINE + PADDING;

        // header (centered)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000000';

        ctx.font = `700 36px ${FONT}`;
        ctx.fillText('Pomocnik Literakowy', CONTENT_CENTER_X, y + TITLE_H / 2);
        y += TITLE_H;

        ctx.font = `400 28px ${FONT}`;
        const modeLabel = payload.modeLabel || '"Gra Dnia"';
        ctx.fillText(modeLabel, CONTENT_CENTER_X, y + SUBTITLE_H / 2);
        y += SUBTITLE_H;

        ctx.font = `400 20px ${FONT}`;
        ctx.fillText(payload.dateLabel, CONTENT_CENTER_X, y + DATE_H / 2);
        y += DATE_H + HEADER_MB;

        // score card with gradient background
        const cardX = CONTENT_X;
        const cx = cardX + CONTENT_W / 2;
        const cy = y + CARD_H / 2;
        const angle = 133 * Math.PI / 180;
        const dx = Math.sin(angle);
        const dy = -Math.cos(angle);
        const halfLen = Math.abs(dx * CONTENT_W / 2) + Math.abs(dy * CARD_H / 2);
        const gradient = ctx.createLinearGradient(
            cx - dx * halfLen, cy - dy * halfLen,
            cx + dx * halfLen, cy + dy * halfLen
        );
        gradient.addColorStop(0, '#E4F7FF');
        gradient.addColorStop(1, '#FDF7DF');
        ctx.fillStyle = gradient;
        ShareImageGenerator.#drawRoundedRect(ctx, cardX, y, CONTENT_W, CARD_H, 20);
        ctx.fill();

        // penguin image
        const IMG_CELL_W = 285;
        const IMG_MAX_W = 266;
        const IMG_MAX_H = 250;
        if (penguinImg) {
            const srcW = penguinImg.naturalWidth || penguinImg.width;
            const srcH = penguinImg.naturalHeight || penguinImg.height;
            const scale = Math.min(IMG_MAX_W / srcW, IMG_MAX_H / srcH);
            const drawW = Math.round(srcW * scale);
            const drawH = Math.round(srcH * scale);

            ctx.drawImage(penguinImg,
                cardX + (IMG_CELL_W - drawW) / 2,
                y + (CARD_H - drawH) / 2,
                drawW, drawH
            );
        }

        // score info block
        const INFO_X = cardX + IMG_CELL_W;
        const LABEL_H = 32;
        const LABEL_MB = 14;
        const SCORE_H = 96;
        const SCORE_MB = 14;
        const TRAFIONE_H = 32;
        const totalInfoH = LABEL_H + LABEL_MB + SCORE_H + SCORE_MB + TRAFIONE_H;

        let iy = y + (CARD_H - totalInfoH) / 2;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#000000';

        ctx.font = `500 32px ${FONT}`;
        ShareImageGenerator.#fillTextTop(ctx, 'Twój wynik', INFO_X, iy);
        iy += LABEL_H + LABEL_MB;

        ctx.font = `700 96px ${FONT}`;
        ShareImageGenerator.#fillTextTop(ctx, `${payload.score} pkt`, INFO_X, iy);
        iy += SCORE_H + SCORE_MB;

        ctx.font = `500 32px ${FONT}`;
        ShareImageGenerator.#fillTextTop(ctx, `Trafione: ${payload.guessedCount}/${payload.totalCount} słów`, INFO_X, iy);

        y += CARD_H + CARD_MB;

        // word list: single comma-separated flow, green = guessed, red = missed
        if (includeWords && wordLayout && wordLayout.length) {
            const wy = y + WORD_TOP_MARGIN;

            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.font = `600 ${WORD_SIZE}px ${FONT}`;
            const wordAscent = ctx.measureText('A').actualBoundingBoxAscent;
            for (const tok of wordLayout) {
                const lineBaseY = wy + tok.lineIdx * LINE_H + wordAscent;
                if (tok.drawSep) {
                    ctx.fillStyle = '#666666';
                    ctx.fillText(SEP, tok.sepX, lineBaseY);
                }
                ctx.fillStyle = tok.found ? '#1B8543' : '#9C2B38';
                ctx.fillText(tok.word, tok.wordX, lineBaseY);
            }
        }

        return ShareImageGenerator.#canvasToBlob(canvas);
    }
}
