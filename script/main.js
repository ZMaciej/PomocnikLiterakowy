let useMockMode = location.search.includes('mock');
let useKidsMode = location.search.includes('kids');
const GAME_OF_DAY_DURATION_SECONDS = 5 * 60; // 5 minutes

// Active word filter for current round (set by GameModeController per-round)
let _activeWordFilter = null;

// ------------------------------------------------------------------------
// Controllers / views (instantiated after DOM is parsed via defer)

const loadingController = new LoadingController();

const guessListView = new GuessListView();

const anagramChecker = new AnagramChecker({ getWordSet });

// ------------------------------------------------------------------------
// Word set loading

async function loadWordSet() {
    const progressCallback = ({ percent, message }) => {
        loadingController.updateProgress(percent);
        loadingController.updateStatus(message);
    };
    if (useMockMode) {
        const sjp = new SlownikJezykaPolskiego();
        await sjp.load('data/mock', progressCallback);
        return sjp;
    }
    if (useKidsMode) {
        const kidsLetters = document.querySelectorAll('.title-kids');
        kidsLetters.forEach(el => el.classList.remove('hidden'));
        const sjp = new SlownikJezykaPolskiego();
        await sjp.load('data/sjp-popular', progressCallback);
        return sjp;
    }
    const sjp = new SlownikJezykaPolskiego();
    await sjp.load('data/sjp-full', progressCallback);
    return sjp;
}

let cachedSetPromise = null;
function getWordSet() {
    if (!cachedSetPromise) {
        cachedSetPromise = loadWordSet();
    }
    return cachedSetPromise;
}

// Console helper: exports precomputed derived stats files for the active dictionary.
window.exportCurrentDerivedStatsFiles = async function exportCurrentDerivedStatsFiles(options = {}) {
    const sjp = await getWordSet();
    if (typeof exportDerivedStatsFilesFromDictionary !== 'function') {
        throw new Error('exportDerivedStatsFilesFromDictionary is unavailable');
    }
    const result = exportDerivedStatsFilesFromDictionary(sjp, options);
    console.log('[StatsExport] Exported derived files', result);
    return result;
};

// Console helper: run regex group-start stats on words of a chosen length.
window.regexGroupStartStats = async function regexGroupStartStats(wordLength, regexOrPattern, flags = 'gm') {
    const sjp = await getWordSet();
    if (typeof SjpStatsGenerator !== 'function') {
        throw new Error('SjpStatsGenerator is unavailable');
    }
    const regex = regexOrPattern instanceof RegExp
        ? regexOrPattern
        : new RegExp(String(regexOrPattern || ''), String(flags || ''));
    const generator = new SjpStatsGenerator(sjp);
    const result = generator.generateRegexCapturingGroupStartStats(wordLength, regex);
    console.log('[RegexGroupStartStats]', {
        wordLength,
        regex: regex.toString(),
        matchingWordsCount: result.matchingWordsCount,
        matchingWords: result.matchingWords,
        firstCapturingGroupStartCounts: result.firstCapturingGroupStartCounts
    });
    return result;
};

// ------------------------------------------------------------------------
// Game state

let gameState = {
    letters: '',
    solutions: [],
    found: new Set(),
    revealedAfterGiveUp: new Set(),
    count: 7,
    skipPenaltyApplied: false,
    roundNumber: 0,
    roundRevealed: false
};

let normalGameScore = 0;
let normalGameStats = {
    totalFound: 0,
    totalSolutions: 0
};

// ------------------------------------------------------------------------
// Game-of-day controller (still used internally by GameModeController)

const gameOfDayController = new GameOfDayController({
    getWordSet,
    guessListView,
    getGameState: () => gameState,
    onStart: () => { gameState.count = 7; },
    onFinish: () => {
        if (gameModeController.currentMode.id === 'fastDaily') {
            gameModeController.onFastDailyFinished();
        }
    },
    updateGameModeUI,
    updateScore: (delta) => {
        // delta already applied by GameModeController; just refresh UI
        updateGameModeUI();
        showRecentDiff(delta);
    },
    newGame,
    clearGuessList: () => guessListView.clear()
});

// Shorthand so callers can still use gameOfDayState.active etc.
const gameOfDayState = gameOfDayController.state;

// ------------------------------------------------------------------------
// Game mode controller

const _gameModes = [
    new Classic7Mode(),
    new FastDailyMode(),
    new SlowDailyMode(),
    new RedTrainingMode()
];

const gameModeController = new GameModeController({
    modes: _gameModes,
    getWordSet,
    guessListView,
    getGameState: () => gameState,
    updateGameModeUI,
    onModeScoreChange: (delta) => showRecentDiff(delta),
    newGame: (sjp, count, wordFilter) => {
        _activeWordFilter = wordFilter || null;
        return newGame(sjp, count);
    },
    clearGuessList: () => guessListView.clear(),
    onRoundStart: () => {},
    gameOfDayController
});

// ------------------------------------------------------------------------
// Tile drag controller

const tileDragController = new TileDragController({
    getLetters: () => gameState.letters,
    setLetters: (s) => { gameState.letters = s; },
    onSwap: () => {}
});

// ------------------------------------------------------------------------
// Navigation

const navigationHandler = new NavigationHandler({
    updateGameModeUI,
    startGame,
    renderLetterTiles,
    getGameState: () => gameState,
    getNormalGameStats: () => normalGameStats
});

// ------------------------------------------------------------------------
// Console dev-stats helper (accessible as window.devStats in browser console)

window.devStats = new ConsoleStats({ getWordSet });

// ------------------------------------------------------------------------
// Helpers

const availableTileLetters = (() => {
    const data = new LiterakiData();
    return new Set(
        Object.keys(data.lettersCount)
            .filter(letter => letter !== '?')
            .map(letter => letter.toLowerCase())
    );
})();

function hasOnlyAvailableTileLetters(word) {
    for (const ch of word) {
        if (!availableTileLetters.has(ch.toLowerCase())) return false;
    }
    return true;
}

function shuffleArray(arr, rng) {
    const randomInt = rng ? max => rng.int(max) : max => Math.floor(Math.random() * max);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatTimer(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const restSeconds = safeSeconds % 60;
    return `${pad2(minutes)}:${pad2(restSeconds)}`;
}

// ------------------------------------------------------------------------
// UI helpers

function updateGameModeUI() {
    const startedControls = document.getElementById('started-game-controls');
    const timerSpacer = document.getElementById('timer-spacer');
    const pointsPanel = document.getElementById('points-panel');
    const gameOfDayBtn = document.getElementById('game-of-the-day-button');
    const gameSection = document.getElementById('game-section');
    const isOnGameSection = gameSection ? gameSection.style.display !== 'none' : false;
    const timerValue = document.getElementById('timer-value');
    const pointsValue = document.getElementById('points');
    const twelveRemaining = document.getElementById('twelve-remaining');

    const mode = gameModeController ? gameModeController.currentMode : null;
    const modeActive = gameModeController ? gameModeController.active : false;
    const hasTimer = mode && mode.hasTimer;

    const showTimedControls = Boolean(hasTimer && isOnGameSection);
    if (startedControls) startedControls.classList.toggle('hidden', !showTimedControls);
    if (timerSpacer) timerSpacer.classList.toggle('hidden', showTimedControls || !isOnGameSection);
    if (pointsPanel) pointsPanel.classList.toggle('hidden', !isOnGameSection);

    if (timerValue) {
        timerValue.textContent = (gameModeController && hasTimer)
            ? gameModeController.getTimerLabel()
            : '00:00';
    }

    if (pointsValue) {
        const label = gameModeController
            ? gameModeController.getPointsLabel()
            : `${normalGameStats.totalFound}/${normalGameStats.totalSolutions}`;
        pointsValue.textContent = label;

        if (!modeActive) {
            const modeId = mode ? mode.id : '';
            const modeState = gameModeController ? gameModeController.currentState : null;
            if (useKidsMode && modeId === 'classic7' && modeState &&
                modeState.totalFound === modeState.totalSolutions &&
                modeState.totalSolutions === 100) {
                document.getElementById('congratulations-overlay').classList.remove('hidden');
                document.getElementById('congratulations-return').addEventListener('click', () => {
                    document.getElementById('congratulations-overlay').classList.add('hidden');
                });
            }
        }
    }

    if (twelveRemaining) {
        if (mode && mode.id === 'slowDaily') {
            const modeState = gameModeController ? gameModeController.currentState : null;
            const remaining = modeState
                ? (modeActive
                    ? Math.max(0, mode.totalRounds - modeState.roundCount + 1)
                    : 0)
                : 0;
            twelveRemaining.textContent = `Pozostało: ${remaining}`;
            twelveRemaining.classList.remove('hidden');
        } else {
            twelveRemaining.textContent = '';
            twelveRemaining.classList.add('hidden');
        }
    }

    // Legacy button (hidden now — start moved to mode selector)
    if (gameOfDayBtn) gameOfDayBtn.classList.add('hidden');

    // Highlight active mode button
    if (mode) {
        document.querySelectorAll('.mode-select-btn').forEach(btn => {
            btn.classList.toggle('chosen', btn.dataset.mode === mode.id);
        });
    }

}

function showRecentDiff(delta) {
    const recentDiffEl = document.getElementById('recent-difference');
    if (!recentDiffEl) return;

    const modeActive = gameModeController ? gameModeController.active : false;
    if (!modeActive || delta === 0) {
        recentDiffEl.textContent = '';
        recentDiffEl.classList.remove('green', 'red');
        return;
    }

    const prefix = delta > 0 ? '+' : '';
    recentDiffEl.textContent = `${prefix}${delta}`;
    recentDiffEl.classList.remove('green', 'red');
    recentDiffEl.classList.add(delta > 0 ? 'green' : 'red');
}

function updateScore(delta) {
    // Score mutations are now handled by the active GameMode object.
    // This function is kept for backward compat (GameOfDayController calls it).
    const pointsValue = document.getElementById('points');
    if (pointsValue && gameModeController) {
        pointsValue.textContent = gameModeController.getPointsLabel();
    }
    showRecentDiff(delta);
}

function revealMissedWordsFromCurrentRound() {
    if (gameState.roundRevealed) return;
    const missedWords = gameState.solutions.filter(word => !gameState.found.has(word));
    missedWords.forEach(word => gameState.revealedAfterGiveUp.add(word));
    missedWords.forEach(word => guessListView.addWord(word, 'missed'));
    gameState.roundRevealed = true;
}

function maybeApplySkipPenalty() {
    if (gameState.skipPenaltyApplied) return;
    gameState.skipPenaltyApplied = true;
    gameModeController.onSkip();
}

// ------------------------------------------------------------------------
// Tile rendering (delegates to TileDragController)

function renderLetterTiles() {
    tileDragController.renderTiles();
}

// ------------------------------------------------------------------------
// Game core

async function startGame() {
    try {
        if (gameModeController && !gameModeController.active) {
            await gameModeController.switchTo(gameModeController.currentMode.id);
            return;
        }
        const sjp = await getWordSet();
        const count = gameState.count || 7;
        await newGame(sjp, count);
    } catch (e) {
        console.error('Cannot start game', e);
    }
}

async function newGame(sjp, count) {
    gameState.count = count;
    gameState.roundNumber += 1;

    if (guessListView.hasEntries()) guessListView.addSeparator();

    const wordFilter = _activeWordFilter;
    const anagramCount = sjp.getSortedAnagramCountsByLength(count);
    if (anagramCount === 0) {
        document.getElementById('letter-display').textContent = 'Brak słów o takiej długości';
        document.getElementById('solution-count').textContent = '0';
        gameState.letters = '';
        gameState.solutions = [];
        gameState.found.clear();
        gameState.revealedAfterGiveUp.clear();
        gameState.skipPenaltyApplied = false;
        gameState.roundRevealed = false;
        return;
    }

    let key = '';
    let solutionList = null;
    const maxAttempts = Math.max(50, anagramCount * 2);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pick = randomControl.wordRng.int(anagramCount);
        const candidateList = sjp.getAnagramListFromIndex(count, pick);
        if (!candidateList || candidateList.length === 0) continue;
        const candidateKey = candidateList[0];
        if (!hasOnlyAvailableTileLetters(candidateKey)) continue;
        if (wordFilter && !candidateList.every(word => wordFilter(word))) continue;
        key = candidateKey;
        solutionList = candidateList;
        break;
    }

    // Rare fallback: full scan to avoid dead-end if random attempts missed valid sets.
    if (!solutionList) {
        for (let idx = 0; idx < anagramCount; idx++) {
            const candidateList = sjp.getAnagramListFromIndex(count, idx);
            if (!candidateList || candidateList.length === 0) continue;
            const candidateKey = candidateList[0];
            if (!hasOnlyAvailableTileLetters(candidateKey)) continue;
            if (wordFilter && !candidateList.every(word => wordFilter(word))) continue;
            key = candidateKey;
            solutionList = candidateList;
            break;
        }
    }

    if (!solutionList) {
        document.getElementById('letter-display').textContent = 'Brak słów możliwych do ułożenia z dostępnych kafelków';
        document.getElementById('solution-count').textContent = '0';
        gameState.letters = '';
        gameState.solutions = [];
        gameState.found.clear();
        gameState.revealedAfterGiveUp.clear();
        gameState.skipPenaltyApplied = false;
        gameState.roundRevealed = false;
        return;
    }

    const letters = shuffleArray(key.split(''), randomControl.mixRng).join('');
    const solutions = Array.from(solutionList).sort();
    gameState.letters = letters;
    gameState.solutions = solutions;
    gameState.found.clear();
    gameState.revealedAfterGiveUp.clear();
    gameState.skipPenaltyApplied = false;
    gameState.roundRevealed = false;

    const mode = gameModeController ? gameModeController.currentMode : null;
    if (mode && mode.id === 'fastDaily' && gameOfDayState.active) {
        gameOfDayState.currentRoundStartIdx = gameOfDayState.allSolutions.length;
        const roundIdx = gameOfDayState.roundCount ?? 0;
        gameOfDayState.roundCount = roundIdx + 1;
        gameState.solutions.forEach(w => gameOfDayState.allSolutions.push({ word: w, found: false, roundIdx }));
    } else if (mode && (mode.id === 'classic7' || mode.id === 'redTraining')) {
        const modeState = gameModeController.currentState;
        modeState.totalSolutions += solutions.length;
    } else if (!mode) {
        normalGameStats.totalSolutions += solutions.length;
    }

    updateGameUI();
}

function updateGameUI() {
    document.getElementById('solution-count').textContent = gameState.solutions.length;
    const guessList = document.getElementById('guess-list');
    tileDragController.resetTiles();
    const correctSection = document.getElementById('correct-section');
    if (gameState.found.size > 0 || (guessList && guessList.children.length > 0)) {
        correctSection.classList.remove('hidden');
    } else {
        correctSection.classList.add('hidden');
    }
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.value = '';
        guessInput.style.backgroundColor = '';
        guessInput.style.display = 'none';
    }
    renderLetterTiles();
}

async function handleGuess(guess) {
    const normalized = guess.trim().toLowerCase();
    if (!normalized) return;
    if (gameState.revealedAfterGiveUp.has(normalized)) {
        triggerShake('letter-tile');
        return;
    }
    if (gameState.solutions.includes(normalized) && !gameState.found.has(normalized)) {
        gameState.found.add(normalized);
        gameModeController.onGuessCorrect(normalized);
        guessListView.addWord(normalized, 'correct');
        const correctSection = document.getElementById('correct-section');
        if (correctSection) correctSection.classList.toggle('hidden', gameState.found.size === 0);
        confettiSeries();
        if (gameState.found.size === gameState.solutions.length) {
            try {
                const mode = gameModeController.currentMode;
                if (mode.id === 'fastDaily') {
                    const sjp = await getWordSet();
                    _activeWordFilter = null;
                    await newGame(sjp, 7);
                } else {
                    await gameModeController.onRoundComplete();
                }
            } catch (e) {
                console.error('Cannot generate next game', e);
            }
        }
    } else {
        gameModeController.onGuessWrong(normalized);
        if (gameModeController.currentMode.id === 'slowDaily') {
            guessListView.addWord(normalized, 'wrong');
            const correctSection = document.getElementById('correct-section');
            if (correctSection) correctSection.classList.remove('hidden');
        }
        triggerShake('letter-tile');
    }
}

// ------------------------------------------------------------------------
// Confetti / animations

function confettiSeries() {
    const delayProfile = [200];
    let totalDelay = 0;
    for (let i = 0; i < 2; i++) {
        setTimeout(fireConfetti, totalDelay);
        totalDelay += delayProfile[i % delayProfile.length];
    }
}

function fireConfetti() {
    const relativePosition = getRelativeCoordinatesOnScreen('check-button');
    const defaults = {
        spread: 55,
        colors: ['#fff67e', '#7eff9f', '#8ac1ff', '#ff9c88'],
        startVelocity: 30,
        particleCount: 100,
    };
    confetti({ ...defaults, angle: 45, origin: { x: 0, y: relativePosition.y } });
    confetti({ ...defaults, angle: 135, origin: { x: 1, y: relativePosition.y } });
}

function triggerShake(className) {
    const elements = document.getElementsByClassName(className);
    if (!elements || elements.length === 0) return;
    for (const el of elements) {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
    }
}

function getRelativeCoordinatesOnScreen(elementName) {
    const element = document.getElementById(elementName);
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return {
        x: rect.left / viewportWidth + (rect.width / 2) / viewportWidth,
        y: rect.top / viewportHeight + (rect.height / 2) / viewportHeight
    };
}

// ------------------------------------------------------------------------
// Event binding

let gameControlsSetup = false;
function setupGameControls() {
    if (gameControlsSetup) return;
    gameControlsSetup = true;

    updateGameModeUI();

    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.addEventListener('input', () => handleGuess(guessInput.value));
        guessInput.style.display = 'none';
    }

    const checkButton = document.getElementById('check-button');
    if (checkButton) {
        checkButton.addEventListener('click', () => handleGuess(gameState.letters));
    }

    const nextButton = document.getElementById('next-button');
    if (nextButton) {
        nextButton.addEventListener('click', async () => {
            maybeApplySkipPenalty();
            revealMissedWordsFromCurrentRound();
            try {
                const mode = gameModeController.currentMode;
                if (mode.id === 'fastDaily') {
                    // daily uses standard 7-letter next round
                    const sjp = await getWordSet();
                    _activeWordFilter = null;
                    await newGame(sjp, 7);
                } else {
                    await gameModeController.onNextRound();
                }
            } catch (e) {
                console.error('Cannot generate next game', e);
            }
        });
    }

    const shuffleButton = document.getElementById('shuffle-button');
    if (shuffleButton) {
        shuffleButton.addEventListener('click', () => {
            if (gameState.letters) {
                gameState.letters = shuffleArray(gameState.letters.split(''), randomControl.mixRng).join('');
                renderLetterTiles();
            }
        });
    }

    const stopGameBtn = document.getElementById('stop-game');
    if (stopGameBtn) {
        stopGameBtn.addEventListener('click', async () => {
            const mode = gameModeController.currentMode;
            if (mode.id === 'fastDaily') {
                await gameOfDayController.returnToNormal();
                await gameModeController.switchTo('classic7');
            } else {
                gameModeController.stop();
                await gameModeController.switchTo('classic7');
            }
        });
    }

    const gameOfDayReturnBtn = document.getElementById('game-of-day-return');
    if (gameOfDayReturnBtn) {
        gameOfDayReturnBtn.addEventListener('click', async () => {
            await gameOfDayController.returnToNormal();
            await gameModeController.switchTo('classic7');
        });
    }

    const gameOfDayShareScoreBtn = document.getElementById('game-of-day-share-score');
    if (gameOfDayShareScoreBtn) {
        gameOfDayShareScoreBtn.addEventListener('click', async () => {
            await gameOfDayController.handleShare(false);
        });
    }

    const gameOfDayShareFullBtn = document.getElementById('game-of-day-share-full');
    if (gameOfDayShareFullBtn) {
        gameOfDayShareFullBtn.addEventListener('click', async () => {
            await gameOfDayController.handleShare(true);
        });
    }

    // Mode selector buttons
    document.querySelectorAll('.mode-select-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const modeId = btn.dataset.mode;
            if (!modeId) return;
            try {
                await gameModeController.switchTo(modeId);
            } catch (e) {
                console.error('Cannot switch game mode', e);
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGameControls);
} else {
    setupGameControls();
}

// ------------------------------------------------------------------------
// Word of the day & stats

let wordOfTheDayController = null;
let statsViewController = null;

async function initializeWordOfTheDay() {
    const wordEl = document.getElementById('word-of-the-day-value');
    const descriptionEl = document.getElementById('word-of-the-day-description');
    if (!wordEl || !descriptionEl || typeof WordOfTheDay !== 'function') return;

    if (!wordOfTheDayController) {
        wordOfTheDayController = new WordOfTheDay({
            filePath: 'data/wotd-most-points/definicje.txt',
            wordElementId: 'word-of-the-day-value',
            descriptionElementId: 'word-of-the-day-description'
        });
    }

    try {
        await wordOfTheDayController.loadAndRender();
    } catch (err) {
        console.error('Failed to load word of the day', err);
    }
}

// ------------------------------------------------------------------------
// App bootstrap

async function init() {
    navigationHandler.setup();
    loadingController.startTimer();
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        loadingController.updateStatus('Wczytywanie słownika...');
        loadingController.updateProgress(10);

        await Promise.all([
            getWordSet(),
            initializeWordOfTheDay()
        ]);

        if (!statsViewController && typeof StatsView === 'function') {
            statsViewController = new StatsView({ getWordSet });
            statsViewController.setup();
        }

        anagramChecker.setup();

        loadingController.updateProgress(100);
        loadingController.stopTimer();

        await new Promise(r => setTimeout(r, 300));
        loadingController.hideScreen();
        navigationHandler.handleHashChange();
    } catch (err) {
        console.error(err);
        loadingController.stopTimer();
        loadingController.updateStatus('Błąd przy wczytywaniu listy słów.');
        await new Promise(r => setTimeout(r, 800));
        loadingController.hideScreen();
        navigationHandler.handleHashChange();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
