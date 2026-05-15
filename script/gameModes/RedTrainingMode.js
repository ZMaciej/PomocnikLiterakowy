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
                if (!key || key.length === 0) return false;
                const first = key[0].toLowerCase();
                const last = key[key.length - 1].toLowerCase();
                return RED_LETTERS.has(first) || RED_LETTERS.has(last);
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
