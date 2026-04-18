let useMockMode = location.search.includes('mock');
let useKidsMode = location.search.includes('kids');
const GAME_OF_DAY_DURATION_SECONDS = 5 * 60; // 5 minutes

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
// Game-of-day controller

const gameOfDayController = new GameOfDayController({
    getWordSet,
    guessListView,
    getGameState: () => gameState,
    onStart: () => { gameState.count = 7; },
    onFinish: () => startGame(),
    updateGameModeUI,
    updateScore,
    newGame,
    clearGuessList: () => guessListView.clear()
});

// Shorthand so callers can still use gameOfDayState.active etc.
const gameOfDayState = gameOfDayController.state;

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
    const pointsPanel = document.getElementById('points-panel');
    const gameOfDayBtn = document.getElementById('game-of-the-day-button');
    const gameSection = document.getElementById('game-section');
    const isOnGameSection = gameSection ? gameSection.style.display !== 'none' : false;
    const timerValue = document.getElementById('timer-value');
    const pointsValue = document.getElementById('points');
    const countButtons = document.querySelectorAll('#letter-count-buttons button');

    if (startedControls) startedControls.classList.toggle('hidden', !gameOfDayState.active || !isOnGameSection);
    if (pointsPanel) pointsPanel.classList.toggle('hidden', !isOnGameSection);
    countButtons.forEach(btn => btn.disabled = gameOfDayState.active);

    if (timerValue) {
        timerValue.textContent = gameOfDayState.active
            ? formatTimer(gameOfDayState.secondsLeft)
            : '00:00';
    }

    if (pointsValue) {
        if (gameOfDayState.active) {
            pointsValue.textContent = String(gameOfDayState.score);
        } else {
            pointsValue.textContent = `${normalGameStats.totalFound}/${normalGameStats.totalSolutions}`;
            if (normalGameStats.totalFound === normalGameStats.totalSolutions &&
                normalGameStats.totalSolutions === 100 && useKidsMode) {
                document.getElementById('congratulations-overlay').classList.remove('hidden');
                document.getElementById('congratulations-return').addEventListener('click', () => {
                    document.getElementById('congratulations-overlay').classList.add('hidden');
                });
            }
        }
    }

    if (gameOfDayBtn) {
        gameOfDayBtn.textContent = 'gra dnia';
        gameOfDayBtn.disabled = false;
        gameOfDayBtn.classList.toggle('hidden', gameOfDayState.active || !isOnGameSection);
    }

    showRecentDiff(0);
}

function showRecentDiff(delta) {
    const recentDiffEl = document.getElementById('recent-difference');
    if (!recentDiffEl) return;

    if (!gameOfDayState.active || delta === 0) {
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
    if (gameOfDayState.active) {
        gameOfDayState.score += delta;
    }
    const pointsValue = document.getElementById('points');
    if (pointsValue) {
        pointsValue.textContent = gameOfDayState.active
            ? String(gameOfDayState.score)
            : `${normalGameStats.totalFound}/${normalGameStats.totalSolutions}`;
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
    const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
    gameState.skipPenaltyApplied = true;
    if (missedCount > 0) updateScore(-5 * missedCount);
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

    if (gameOfDayState.active) {
        gameOfDayState.currentRoundStartIdx = gameOfDayState.allSolutions.length;
        const roundIdx = gameOfDayState.roundCount ?? 0;
        gameOfDayState.roundCount = roundIdx + 1;
        gameState.solutions.forEach(w => gameOfDayState.allSolutions.push({ word: w, found: false, roundIdx }));
    } else {
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
        if (gameOfDayState.active) {
            const roundEntry = gameOfDayState.allSolutions.find(
                (entry, i) => i >= gameOfDayState.currentRoundStartIdx
                    && entry.word.toLowerCase() === normalized
                    && !entry.found
            );
            if (roundEntry) roundEntry.found = true;
            updateScore(50);
        } else {
            normalGameStats.totalFound += 1;
            updateGameModeUI();
        }
        guessListView.addWord(normalized, 'correct');
        const correctSection = document.getElementById('correct-section');
        if (correctSection) correctSection.classList.toggle('hidden', gameState.found.size === 0);
        confettiSeries();
        if (gameState.found.size === gameState.solutions.length) {
            const count = gameState.count || 7;
            try {
                const sjp = await getWordSet();
                await newGame(sjp, count);
            } catch (e) {
                console.error('Cannot generate next game', e);
            }
        }
    } else {
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
            const count = gameState.count || 7;
            try {
                const sjp = await getWordSet();
                await newGame(sjp, count);
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

    const gameOfDayBtn = document.getElementById('game-of-the-day-button');
    if (gameOfDayBtn) {
        gameOfDayBtn.addEventListener('click', async () => {
            try {
                await gameOfDayController.start();
            } catch (e) {
                console.error('Cannot start game of the day', e);
            }
        });
    }

    const stopGameBtn = document.getElementById('stop-game');
    if (stopGameBtn) {
        stopGameBtn.addEventListener('click', async () => {
            if (!gameOfDayState.active) return;
            await gameOfDayController.returnToNormal();
        });
    }

    const gameOfDayReturnBtn = document.getElementById('game-of-day-return');
    if (gameOfDayReturnBtn) {
        gameOfDayReturnBtn.addEventListener('click', async () => {
            await gameOfDayController.returnToNormal();
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

    const button6 = document.getElementById('button-6');
    const button7 = document.getElementById('button-7');
    const button8 = document.getElementById('button-8');
    const button9 = document.getElementById('button-9');
    const countButtons = [button6, button7, button8, button9];

    [[button6, 6], [button7, 7], [button8, 8], [button9, 9]].forEach(([btn, n]) => {
        if (btn) btn.addEventListener('click', () => handleCountSelect(n, btn, countButtons));
    });
}

function handleCountSelect(count, selectedButton, countButtons) {
    countButtons.forEach(btn => btn && btn.classList.remove('chosen'));
    selectedButton.classList.add('chosen');
    gameState.count = count;
    startGame();
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
