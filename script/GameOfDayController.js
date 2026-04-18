class GameOfDayController {
    /**
     * @param {{
     *   getWordSet: () => Promise,
     *   guessListView: GuessListView,
     *   getGameState: () => object,
     *   onStart: () => void,
     *   onFinish: () => void,
     *   updateGameModeUI: () => void,
     *   updateScore: (delta: number) => void,
     *   newGame: (sjp: object, count: number) => Promise,
     *   clearGuessList: () => void
     * }} deps
     */
    constructor({ getWordSet, guessListView, getGameState, onStart, onFinish, updateGameModeUI, updateScore, newGame, clearGuessList }) {
        this._getWordSet = getWordSet;
        this._guessListView = guessListView;
        this._getGameState = getGameState;
        this._onStart = onStart;
        this._onFinish = onFinish;
        this._updateGameModeUI = updateGameModeUI;
        this._updateScore = updateScore;
        this._newGame = newGame;
        this._clearGuessList = clearGuessList;

        this.state = {
            active: false,
            score: 0,
            secondsLeft: GAME_OF_DAY_DURATION_SECONDS,
            timerId: null,
            allSolutions: [],
            currentRoundStartIdx: 0,
            roundCount: 0,
            dateLabel: ''
        };

        this._shareInProgress = false;
        this._preGeneratedBlobs = { score: null, full: null };
    }

    getTodayDateLabel(date = new Date()) {
        return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
    }

    stopTimer() {
        if (this.state.timerId) {
            clearInterval(this.state.timerId);
            this.state.timerId = null;
        }
    }

    _startTimer() {
        this.stopTimer();
        const timerValue = document.getElementById('timer-value');
        if (timerValue) timerValue.textContent = formatTimer(this.state.secondsLeft);
        this.state.timerId = setInterval(() => {
            this.state.secondsLeft -= 1;
            if (timerValue) timerValue.textContent = formatTimer(this.state.secondsLeft);
            if (this.state.secondsLeft <= 0) {
                this.finish();
            }
        }, 1000);
    }

    async start() {
        this._preGeneratedBlobs = { score: null, full: null };
        this._hideResultOverlay();
        this._clearGuessList();
        configureRandomMode('daily');
        const dateLabel = this.getTodayDateLabel();
        const gameOfDayDate = document.getElementById('game-of-day-date');
        if (gameOfDayDate) gameOfDayDate.textContent = `(${dateLabel})`;

        this.state.active = true;
        this.state.dateLabel = dateLabel;
        this.state.score = 0;
        this.state.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
        this.state.allSolutions = [];
        this.state.currentRoundStartIdx = 0;
        this.state.roundCount = 0;

        this._onStart();
        this._updateGameModeUI();

        const sjp = await this._getWordSet();
        await this._newGame(sjp, 7);
        this._startTimer();
    }

    async returnToNormal() {
        this.stopTimer();
        this.state.active = false;
        this.state.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
        this._clearGuessList();
        this._hideResultOverlay();
        configureRandomMode('normal');
        this._updateGameModeUI();
        this._onFinish();
    }

    finish() {
        if (!this.state.active) return;
        this.stopTimer();

        const gameState = this._getGameState();
        const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
        if (missedCount > 0) {
            this._updateScore(-5 * missedCount);
        }

        this.state.active = false;
        this._clearGuessList();
        this._updateGameModeUI();

        const uiLock = document.getElementById('ui-lock-overlay');
        if (uiLock) uiLock.style.display = 'block';
        this._showResultOverlay();
        setTimeout(() => {
            if (uiLock) uiLock.style.display = 'none';
        }, 2000);

        this._preGeneratedBlobs = { score: null, full: null };
        this._preGenerateShareImages();
    }

    _getSharePayload() {
        const guessedWords = [];
        const missedWords = [];
        this.state.allSolutions.forEach(({ word, found }) => {
            if (found) guessedWords.push(word);
            else missedWords.push(word);
        });

        // Build wordGroups: array-of-arrays grouped by roundIdx, preserving order.
        const groupMap = new Map();
        this.state.allSolutions.forEach(({ word, found, roundIdx }) => {
            const idx = roundIdx ?? 0;
            if (!groupMap.has(idx)) groupMap.set(idx, []);
            groupMap.get(idx).push({ word, found });
        });
        const wordGroups = Array.from(groupMap.keys())
            .sort((a, b) => a - b)
            .map(k => groupMap.get(k));

        return {
            dateLabel: this.state.dateLabel || this.getTodayDateLabel(),
            score: this.state.score,
            allWords: this.state.allSolutions.map(e => e.word),
            guessedWords,
            missedWords,
            wordGroups,
            guessedCount: guessedWords.length,
            totalCount: this.state.allSolutions.length
        };
    }

    _setShareStatus(message, tone = 'neutral') {
        const statusEl = document.getElementById('game-of-day-share-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.classList.remove('green', 'red');
        if (tone === 'success') statusEl.classList.add('green');
        else if (tone === 'error') statusEl.classList.add('red');
    }

    _setShareButtonsDisabled(disabled) {
        ['game-of-day-share-score', 'game-of-day-share-full'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = disabled;
        });
    }

    async _generateShareImage(payload, options = {}) {
        return ShareImageGenerator.generate(payload, options);
    }

    async _preGenerateShareImages() {
        this._setShareButtonsDisabled(true);
        this._setShareStatus('Przygotowuję obrazek...');
        const payload = this._getSharePayload();
        try {
            this._preGeneratedBlobs.score = await this._generateShareImage(payload, { includeWords: false });
        } catch (e) {
            console.warn('[Share] Pre-generation of score image failed', e);
        }
        try {
            this._preGeneratedBlobs.full = await this._generateShareImage(payload, { includeWords: true });
        } catch (e) {
            console.warn('[Share] Pre-generation of full image failed', e);
        }
        this._setShareStatus('');
        this._setShareButtonsDisabled(false);
    }

    _downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async handleShare(includeWords) {
        if (this._shareInProgress) return;
        try {
            this._shareInProgress = true;
            this._setShareButtonsDisabled(true);

            const payload = this._getSharePayload();
            const preGenKey = includeWords ? 'full' : 'score';
            let blob = this._preGeneratedBlobs[preGenKey];

            if (!blob) {
                this._setShareStatus('Przygotowuję obrazek...');
                blob = await this._generateShareImage(payload, { includeWords });
                this._preGeneratedBlobs[preGenKey] = blob;
            }

            const suffix = includeWords ? '-wynik-slowa' : '-wynik';
            const fileName = `pomocnik-literakowy-${payload.dateLabel}${suffix}.png`;
            const imageFile = new File([blob], fileName, { type: 'image/png' });

            const hasShare = !!navigator.share;
            const canShareFiles = !navigator.canShare || navigator.canShare({ files: [imageFile] });

            if (hasShare && canShareFiles) {
                await navigator.share({
                    title: `Pomocnik Literakowy ${payload.dateLabel}`,
                    text: includeWords
                        ? `Gra dnia ${payload.dateLabel}: ${payload.score} pkt + lista słów`
                        : `Gra dnia ${payload.dateLabel}: ${payload.score} pkt`,
                    files: [imageFile]
                });
                this._setShareStatus('Udostępniono obrazek.', 'success');
                return;
            }

            this._downloadBlob(blob, fileName);
            this._setShareStatus('Na tym urządzeniu natywne udostępnianie obrazka nie jest dostępne. PNG zostało pobrane.', 'success');
        } catch (error) {
            if (error && error.name === 'AbortError') {
                this._setShareStatus('Udostępnianie anulowane.');
            } else {
                console.error('Failed to share game-of-day result', error);
                const name = error && error.name ? error.name : 'UnknownError';
                const msg = error && error.message ? error.message : String(error);
                this._setShareStatus(`Błąd [${name}]: ${msg}`, 'error');
            }
        } finally {
            this._shareInProgress = false;
            this._setShareButtonsDisabled(false);
        }
    }

    _showResultOverlay() {
        const overlay = document.getElementById('game-of-day-overlay');
        const scoreEl = document.getElementById('game-of-day-score');
        const wordListEl = document.getElementById('game-of-day-words-list');

        if (scoreEl) scoreEl.textContent = String(this.state.score);

        if (wordListEl) {
            wordListEl.innerHTML = '';
            this.state.allSolutions.forEach(({ word, found }, idx) => {
                if (idx > 0) wordListEl.appendChild(document.createTextNode(', '));
                const a = document.createElement('a');
                a.textContent = word;
                a.href = `https://sjp.pl/${encodeURIComponent(word)}`;
                a.target = '_blank';
                a.rel = 'noopener';
                a.classList.add(found ? 'guess-correct' : 'guess-missed');
                wordListEl.appendChild(a);
            });
        }

        this._setShareStatus('');
        if (overlay) overlay.classList.remove('hidden');
    }

    _hideResultOverlay() {
        const overlay = document.getElementById('game-of-day-overlay');
        if (overlay) overlay.classList.add('hidden');
    }
}
