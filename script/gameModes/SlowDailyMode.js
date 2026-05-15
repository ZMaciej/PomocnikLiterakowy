// ============================================================
// Slow Daily mode
// ============================================================

class SlowDailyMode {
    get id() { return 'slowDaily'; }
    get label() { return '🐢'; }
    get emoji() { return '🐢'; }
    get hasTimer() { return true; }
    get timerCountsUp() { return true; }
    get wordLength() { return 7; }
    get totalRounds() { return 5; }

    createState() {
        return {
            score: 0,
            secondsElapsed: 0,
            totalSolutions: 0,
            allSolutions: [],
            wrongGuesses: [],
            currentRoundStartIdx: 0,
            roundCount: 0
        };
    }

    getRoundConfig() {
        return { length: 7, wordFilter: null };
    }

    onGuessCorrect(modeState, word) {
        if (modeState.allSolutions) {
            const roundEntry = modeState.allSolutions.find(
                (entry, i) => i >= (modeState.currentRoundStartIdx || 0)
                    && entry.word.toLowerCase() === word.toLowerCase()
                    && !entry.found
            );
            if (roundEntry) roundEntry.found = true;
        }
        modeState.score += 50;
    }

    onGuessWrong(modeState, word) {
        const key = word ? word.toLowerCase() : null;
        if (key && modeState.wrongGuesses.includes(key)) {
            return;
        }
        modeState.score -= 1;
        if (key) {
            modeState.wrongGuesses.push(key);
        }
    }

    onSkip(modeState, missedCount) {
        modeState.score -= 25 * missedCount;
    }

    getPointsLabel(modeState) {
        return String(modeState.score);
    }

    isFinished(modeState) {
        return modeState.roundCount >= this.totalRounds;
    }

    onRoundStart(modeState, solutions) {
        modeState.currentRoundStartIdx = modeState.allSolutions.length;
        const roundIdx = modeState.roundCount;
        modeState.roundCount += 1;
        solutions.forEach(w => modeState.allSolutions.push({ word: w, found: false, roundIdx }));
    }
}
