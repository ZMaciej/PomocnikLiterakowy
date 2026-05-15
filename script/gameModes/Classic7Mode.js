// ============================================================
// Classic 7 mode
// ============================================================

class Classic7Mode {
    get id() { return 'classic7'; }
    get label() { return '7'; }
    get emoji() { return '7'; }
    get hasTimer() { return false; }
    get timerCountsUp() { return false; }
    get wordLength() { return 7; }

    createState() {
        return {
            totalFound: 0,
            totalSolutions: 0
        };
    }

    getRoundConfig() {
        return { length: 7, wordFilter: null };
    }

    onGuessCorrect(modeState) {
        modeState.totalFound += 1;
    }

    onGuessWrong(_modeState) {
        // no penalty
    }

    onSkip(_modeState, _missedCount) {
        // no penalty in classic
    }

    getPointsLabel(modeState) {
        return `${modeState.totalFound}/${modeState.totalSolutions}`;
    }

    isFinished(_modeState) {
        return false; // plays indefinitely
    }
}
