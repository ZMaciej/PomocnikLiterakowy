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

        const penguinImg = await ShareImageGenerator.#loadShareImage('pingwinDab.png');

        const COL_W = CONTENT_W / 2;       // 406
        const LEFT_INNER_W = COL_W - 24;   // 382
        const WORD_SIZE = 28;
        const WORD_LINE_H = Math.round(WORD_SIZE * 1.45);
        const HEADING_SIZE = 32;
        const HEADING_LINE_H = Math.round(HEADING_SIZE * 1.3);
        const HEADING_MB = 7;

        let wordSectionH = 0;
        if (includeWords) {
            const tmpCtx = document.createElement('canvas').getContext('2d');
            tmpCtx.font = `600 ${WORD_SIZE}px ${FONT}`;
            const gText = payload.guessedWords.length ? payload.guessedWords.join(', ') : 'brak';
            const mText = payload.missedWords.length ? payload.missedWords.join(', ') : 'brak';
            const bodyLines = Math.max(
                ShareImageGenerator.#wrapToLines(tmpCtx, gText, LEFT_INNER_W).length,
                ShareImageGenerator.#wrapToLines(tmpCtx, mText, COL_W).length
            );
            wordSectionH = HEADING_LINE_H + HEADING_MB + bodyLines * WORD_LINE_H + 8;
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
        ctx.fillText('"Gra Dnia"', CONTENT_CENTER_X, y + SUBTITLE_H / 2);
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
        const IMG_W = 266;
        const IMG_H = 250;
        if (penguinImg) {
            ctx.drawImage(penguinImg,
                cardX + (IMG_CELL_W - IMG_W) / 2,
                y + (CARD_H - IMG_H) / 2,
                IMG_W, IMG_H
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
        ctx.fillText('Twój wynik', INFO_X, iy);
        iy += LABEL_H + LABEL_MB;

        ctx.font = `700 96px ${FONT}`;
        ctx.fillText(`${payload.score} pkt`, INFO_X, iy);
        iy += SCORE_H + SCORE_MB;

        ctx.font = `500 32px ${FONT}`;
        ctx.fillText(`Trafione: ${payload.guessedCount}/${payload.totalCount} słów`, INFO_X, iy);

        y += CARD_H + CARD_MB;

        // word sections
        if (includeWords) {
            const LEFT_COL_X = CONTENT_X;
            const RIGHT_COL_X = CONTENT_X + COL_W;

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#000000';
            ctx.font = `500 ${HEADING_SIZE}px ${FONT}`;
            ctx.fillText('Zgadnięte słowa:', LEFT_COL_X, y);
            ctx.fillText('Nieodgadnięte słowa:', RIGHT_COL_X, y);

            const wy = y + HEADING_LINE_H + HEADING_MB;

            if (!payload.guessedWords.length) {
                ctx.font = `italic 400 ${WORD_SIZE}px ${FONT}`;
                ctx.fillStyle = '#888888';
                ctx.fillText('brak', LEFT_COL_X, wy);
            } else {
                ctx.font = `600 ${WORD_SIZE}px ${FONT}`;
                ctx.fillStyle = '#1B8543';
                ShareImageGenerator.#wrapToLines(ctx, payload.guessedWords.join(', '), LEFT_INNER_W)
                    .forEach((line, i) => ctx.fillText(line, LEFT_COL_X, wy + i * WORD_LINE_H));
            }

            if (!payload.missedWords.length) {
                ctx.font = `italic 400 ${WORD_SIZE}px ${FONT}`;
                ctx.fillStyle = '#888888';
                ctx.fillText('brak', RIGHT_COL_X, wy);
            } else {
                ctx.font = `600 ${WORD_SIZE}px ${FONT}`;
                ctx.fillStyle = '#9C2B38';
                ShareImageGenerator.#wrapToLines(ctx, payload.missedWords.join(', '), COL_W)
                    .forEach((line, i) => ctx.fillText(line, RIGHT_COL_X, wy + i * WORD_LINE_H));
            }
        }

        return ShareImageGenerator.#canvasToBlob(canvas);
    }
}
