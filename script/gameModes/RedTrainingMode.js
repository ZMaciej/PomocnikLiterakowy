// ============================================================
// Red Training mode
// ============================================================

// Red-letter set: letters worth 5 pts in Literaki
const RED_LETTERS = new Set(['ą', 'ć', 'ę', 'f', 'ń', 'ó', 'ś', 'ź', 'ż']);

class RedTrainingMode {
    get id() { return 'redTraining'; }
    get label() { return '🔴'; }
    get emoji() { return '🔴'; }
    get hasTimer() { return false; }
    get timerCountsUp() { return false; }

    createState() {
        return {
            totalFound: 0,
            totalSolutions: 0
        };
    }

    getRoundConfig(rng) {
        // Random length 3-7
        const length = 3 + (rng ? rng.int(5) : Math.floor(Math.random() * 5));
        return {
            length,
            wordFilter: key => {
                for (const ch of key) {
                    if (RED_LETTERS.has(ch.toLowerCase())) return true;
                }
                return false;
            }
        };
    }

    onGuessCorrect(modeState) {
        modeState.totalFound += 1;
    }

    onGuessWrong(_modeState) {
        // no penalty
    }

    onSkip(_modeState, _missedCount) {
        // no penalty
    }

    getPointsLabel(modeState) {
        return `${modeState.totalFound}/${modeState.totalSolutions}`;
    }

    isFinished(_modeState) {
        return false;
    }
}
