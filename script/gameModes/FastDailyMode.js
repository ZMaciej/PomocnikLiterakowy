// ============================================================
// Fast Daily mode
// ============================================================

class FastDailyMode {
    get id() { return 'fastDaily'; }
    get label() { return '⚡'; }
    get emoji() { return '⚡'; }
    get hasTimer() { return true; }
    get timerCountsUp() { return false; }
    get wordLength() { return 7; }

    createState() {
        return {
            score: 0,
            secondsLeft: GAME_OF_DAY_DURATION_SECONDS,
            allSolutions: [],
            currentRoundStartIdx: 0,
            roundCount: 0,
            dateLabel: ''
        };
    }

    getRoundConfig() {
        return { length: 7, wordFilter: null };
    }

    onGuessCorrect(modeState, word) {
        const roundEntry = modeState.allSolutions.find(
            (entry, i) => i >= modeState.currentRoundStartIdx
                && entry.word.toLowerCase() === word.toLowerCase()
                && !entry.found
        );
        if (roundEntry) roundEntry.found = true;
        modeState.score += 50;
    }

    onGuessWrong(_modeState) {
        // no per-guess penalty in fastDaily
    }

    onSkip(modeState, missedCount) {
        modeState.score -= 5 * missedCount;
    }

    getPointsLabel(modeState) {
        return String(modeState.score);
    }

    isFinished(modeState) {
        return modeState.secondsLeft <= 0;
    }

    onRoundStart(modeState, solutions) {
        modeState.currentRoundStartIdx = modeState.allSolutions.length;
        const roundIdx = modeState.roundCount;
        modeState.roundCount += 1;
        modeState.totalSolutions = (modeState.totalSolutions || 0) + solutions.length;
        solutions.forEach(w => modeState.allSolutions.push({ word: w, found: false, roundIdx }));
    }
}
