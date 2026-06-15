// ============================================================
// GameModeController
// ============================================================

class GameModeController {
    /**
     * @param {{
     *   modes: object[],
     *   getWordSet: () => Promise,
     *   guessListView: object,
     *   getGameState: () => object,
     *   updateGameModeUI: () => void,
     *   onModeScoreChange: (delta: number) => void,
     *   newGame: (sjp, count, wordFilter) => Promise,
     *   clearGuessList: () => void,
     *   onRoundStart: () => void,
     *   gameOfDayController: object
     * }} deps
     */
    constructor({ modes, getWordSet, guessListView, getGameState, updateGameModeUI,
                  onModeScoreChange, newGame, clearGuessList, onRoundStart, gameOfDayController }) {
        this._modes = modes;
        this._getWordSet = getWordSet;
        this._guessListView = guessListView;
        this._getGameState = getGameState;
        this._updateGameModeUI = updateGameModeUI;
        this._onModeScoreChange = onModeScoreChange;
        this._newGame = newGame;
        this._clearGuessList = clearGuessList;
        this._onRoundStart = onRoundStart;
        this._gameOfDayController = gameOfDayController;

        // Saved per-mode state snapshots (preserved when switching)
        this._savedStates = {};
        modes.forEach(m => { this._savedStates[m.id] = m.createState(); });

        this.activeMode = modes.find(m => m.id === 'classic7') || modes[0];
        this._timerId = null;
        this._active = false;
    }

    get active() { return this._active; }
    get currentMode() { return this.activeMode; }
    get currentState() { return this._savedStates[this.activeMode.id]; }

    getModeById(id) {
        return this._modes.find(m => m.id === id) || null;
    }

    _getScoreValue(mode, modeState) {
        if (!mode) return null;
        if (mode.id === 'fastDaily') return this._gameOfDayController.state.score;
        if (modeState && typeof modeState.score === 'number') return modeState.score;
        return null;
    }

    _emitScoreDelta(before, after) {
        if (typeof before !== 'number' || typeof after !== 'number') return;
        const delta = after - before;
        if (delta !== 0) this._onModeScoreChange(delta);
    }

    _resetSharedRoundState() {
        const gameState = this._getGameState();
        if (!gameState) return;
        gameState.letters = '';
        gameState.solutions = [];
        gameState.found.clear();
        gameState.revealedAfterGiveUp.clear();
        gameState.skipPenaltyApplied = false;
        gameState.roundRevealed = false;
    }

    // ---- Switching -----------------------------------------

    async switchTo(modeId) {
        if (this._active && this.activeMode.id === modeId) return;

        // Clear diff badge when changing mode context.
        this._onModeScoreChange(0);

        // Pause current timed mode
        if (this._active) {
            this._stopTimer();
        }

        // Leaving slowDaily should reset its elapsed timer.
        if (this._active && this.activeMode.id === 'slowDaily' && modeId !== 'slowDaily') {
            const slowDailyState = this._savedStates.slowDaily;
            if (slowDailyState) slowDailyState.secondsElapsed = 0;
        }

        // For fastDaily, delegate stop to gameOfDayController
        if (this._active && this.activeMode.id === 'fastDaily') {
            this._gameOfDayController.stopTimer();
            this._gameOfDayController.state.active = false;
        }

        const nextMode = this._modes.find(m => m.id === modeId);
        if (!nextMode) return;

        // Always start target mode from a clean state on switch.
        this._savedStates[nextMode.id] = nextMode.createState();
        this._resetSharedRoundState();

        // Always clear guess list when switching modes
        this._clearGuessList();

        this.activeMode = nextMode;
        this._active = true;

        if (modeId === 'fastDaily') {
            await this._startFastDaily();
        } else {
            if (modeId === 'classic7' || modeId === 'redTraining') {
                refreshNormalRandomSeed();
            }
            configureRandomMode(modeId === 'slowDaily' ? 'slowDaily' : 'normal');
            await this._startRound();
            if (nextMode.hasTimer) {
                this._startTimer();
            }
        }
        this._updateGameModeUI();
    }

    // ---- Fast Daily delegation -----------------------------

    async _startFastDaily() {
        const gc = this._gameOfDayController;
        // Sync our saved state with gc state
        const ds = this._savedStates['fastDaily'];
        gc.state.active = true;
        gc.state.modeEmoji = '⚡';
        gc.state.wrongGuesses = [];
        gc.state.secondsElapsed = null;
        gc.state.score = ds.score;
        gc.state.secondsLeft = ds.secondsLeft;
        gc.state.allSolutions = ds.allSolutions;
        gc.state.currentRoundStartIdx = ds.currentRoundStartIdx;
        gc.state.roundCount = ds.roundCount;
        gc.state.dateLabel = ds.dateLabel || gc.getTodayDateLabel();

        // Fresh start when score == 0 and no rounds yet (first activation)
        if (ds.roundCount === 0) {
            gc.state.score = 0;
            gc.state.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
            gc.state.allSolutions = [];
            gc.state.currentRoundStartIdx = 0;
            gc.state.roundCount = 0;
            gc.state.dateLabel = gc.getTodayDateLabel();
            ds.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
            ds.dateLabel = gc.state.dateLabel;

            const gameOfDayDate = document.getElementById('game-of-day-date');
            if (gameOfDayDate) gameOfDayDate.textContent = `(${gc.state.dateLabel})`;

            configureRandomMode('fastDaily');
            const sjp = await this._getWordSet();
            await this._newGame(sjp, 7, null);
        }
        gc._startTimer();
        this._syncFastDailyStateBack();
    }

    _syncFastDailyStateBack() {
        const gc = this._gameOfDayController;
        const ds = this._savedStates['fastDaily'];
        ds.score = gc.state.score;
        ds.secondsLeft = gc.state.secondsLeft;
        ds.allSolutions = gc.state.allSolutions;
        ds.currentRoundStartIdx = gc.state.currentRoundStartIdx;
        ds.roundCount = gc.state.roundCount;
        ds.dateLabel = gc.state.dateLabel;
    }

    // ---- Round start ---------------------------------------

    async _startRound() {
        const mode = this.activeMode;
        const modeState = this.currentState;
        const rng = randomControl.wordRng;
        const config = mode.getRoundConfig ? mode.getRoundConfig(rng) : { length: 7, wordFilter: null };
        const sjp = await this._getWordSet();
        await this._newGame(sjp, config.length, config.wordFilter);
        if (mode.onRoundStart) {
            mode.onRoundStart(modeState, this._getGameState().solutions);
        }
        this._onRoundStart();
        this._updateGameModeUI();
    }

    // ---- Events forwarded from main ------------------------

    onGuessCorrect(word) {
        const mode = this.activeMode;
        const modeState = this.currentState;
        const before = this._getScoreValue(mode, modeState);
        if (mode.id === 'fastDaily') {
            mode.onGuessCorrect(this._gameOfDayController.state, word);
            this._syncFastDailyStateBack();
        } else {
            mode.onGuessCorrect(modeState, word);
        }
        const after = this._getScoreValue(mode, modeState);
        this._emitScoreDelta(before, after);
        this._updateGameModeUI();
    }

    onGuessWrong(word) {
        const mode = this.activeMode;
        const modeState = this.currentState;
        const before = this._getScoreValue(mode, modeState);
        if (mode.id === 'fastDaily') {
            mode.onGuessWrong(this._gameOfDayController.state);
            this._syncFastDailyStateBack();
        } else {
            mode.onGuessWrong(modeState, word);
        }
        const after = this._getScoreValue(mode, modeState);
        this._emitScoreDelta(before, after);
        this._updateGameModeUI();
    }

    onSkip() {
        const mode = this.activeMode;
        const modeState = this.currentState;
        const before = this._getScoreValue(mode, modeState);
        const gameState = this._getGameState();
        const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
        if (mode.id === 'fastDaily') {
            mode.onSkip(this._gameOfDayController.state, missedCount);
            this._syncFastDailyStateBack();
        } else {
            mode.onSkip(modeState, missedCount);
        }
        const after = this._getScoreValue(mode, modeState);
        this._emitScoreDelta(before, after);
        this._updateGameModeUI();
    }

    getPointsLabel() {
        const mode = this.activeMode;
        const modeState = mode.id === 'fastDaily'
            ? this._gameOfDayController.state
            : this.currentState;
        return mode.getPointsLabel(modeState);
    }

    getTimerLabel() {
        const mode = this.activeMode;
        if (!mode.hasTimer) return '00:00';
        if (mode.id === 'fastDaily') {
            return formatTimer(this._gameOfDayController.state.secondsLeft);
        }
        if (mode.timerCountsUp) {
            return formatTimer(this.currentState.secondsElapsed);
        }
        return formatTimer(this.currentState.secondsLeft ?? 0);
    }

    // ---- Timer ---------------------------------------------

    _startTimer() {
        this._stopTimer();
        const mode = this.activeMode;
        const timerEl = document.getElementById('timer-value');
        this._timerId = setInterval(() => {
            if (mode.timerCountsUp) {
                this.currentState.secondsElapsed += 1;
            } else {
                this.currentState.secondsLeft -= 1;
            }
            if (timerEl) timerEl.textContent = this.getTimerLabel();
            if (!mode.timerCountsUp && this.currentState.secondsLeft <= 0) {
                this._onSlowDailyFinish();
            }
        }, 1000);
    }

    _stopTimer() {
        if (this._timerId) {
            clearInterval(this._timerId);
            this._timerId = null;
        }
    }

    async _onSlowDailyFinish() {
        this._stopTimer();
        // Apply skip penalty for current round
        const gameState = this._getGameState();
        const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
        if (missedCount > 0 && !gameState.skipPenaltyApplied) {
            this.activeMode.onSkip(this.currentState, missedCount);
        }
        this._finishSlowDaily();
    }

    _showSlowDailyResultOverlay() {
        const modeState = this._savedStates.slowDaily || this.currentState;
        const gc = this._gameOfDayController;

        gc.stopTimer();
        gc.state.active = false;
        gc.state.dateLabel = gc.getTodayDateLabel();
        gc.state.modeEmoji = '🐢';
        gc.state.score = modeState && typeof modeState.score === 'number' ? modeState.score : 0;
        gc.state.allSolutions = (modeState && Array.isArray(modeState.allSolutions))
            ? modeState.allSolutions.map(entry => ({ ...entry }))
            : [];
        gc.state.currentRoundStartIdx = modeState && typeof modeState.currentRoundStartIdx === 'number'
            ? modeState.currentRoundStartIdx
            : 0;
        gc.state.roundCount = modeState && typeof modeState.roundCount === 'number'
            ? modeState.roundCount
            : 0;
        gc.state.wrongGuesses = (modeState && Array.isArray(modeState.wrongGuesses))
            ? [...modeState.wrongGuesses]
            : [];
        gc.state.secondsElapsed = (modeState && typeof modeState.secondsElapsed === 'number')
            ? modeState.secondsElapsed
            : null;

        const gameOfDayDate = document.getElementById('game-of-day-date');
        if (gameOfDayDate) gameOfDayDate.textContent = `(${gc.state.dateLabel})`;

        gc._preGeneratedBlobs = { score: null, full: null };
        gc._showResultOverlay();
        gc._preGenerateShareImages();
    }

    _finishSlowDaily() {
        this._active = false;
        this._updateGameModeUI();
        this._showSlowDailyResultOverlay();
    }

    // ---- Called when a round ends naturally (all words found)
    async onRoundComplete() {
        const mode = this.activeMode;
        if (mode.id === 'fastDaily') {
            // fastDaily auto-advances
            return;
        }
        if (mode.isFinished(this.currentState)) {
            if (mode.id === 'slowDaily') {
                this._finishSlowDaily();
            }
            return;
        }
        await this._startRound();
    }

    // ---- Next button (skip) --------------------------------

    async onNextRound() {
        const mode = this.activeMode;
        if (mode.id === 'fastDaily') {
            // Let GameOfDayController handle the fastDaily flow
            return;
        }
        // Check if slowDaily mode is finished after this skip
        if (mode.id === 'slowDaily' && mode.isFinished(this.currentState)) {
            this._finishSlowDaily();
            return;
        }
        await this._startRound();
    }

    // ---- Stop current mode (e.g. user switches to another) -
    stop() {
        this._stopTimer();
        this._onModeScoreChange(0);
        if (this.activeMode.id === 'slowDaily') {
            const slowDailyState = this._savedStates.slowDaily;
            if (slowDailyState) slowDailyState.secondsElapsed = 0;
        }
        if (this.activeMode.id === 'fastDaily') {
            this._gameOfDayController.stopTimer();
            this._gameOfDayController.state.active = false;
            this._syncFastDailyStateBack();
        }

        // Stopping a mode also clears its persisted state.
        this._savedStates[this.activeMode.id] = this.activeMode.createState();
        this._resetSharedRoundState();
        this._active = false;
    }

    // ---- Called after fastDaily finishes (GameOfDayController.finish)
    onFastDailyFinished() {
        this._syncFastDailyStateBack();
        this._onModeScoreChange(0);
        this._active = false;
        this._updateGameModeUI();
    }
}
