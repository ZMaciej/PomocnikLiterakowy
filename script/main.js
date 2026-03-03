// ---- mock helpers -------------------------------------------------------
// a tiny fake dictionary that can be swapped in during UI work.  the
// real loader is expensive so appending "?mock" to the URL or calling
// `setMockMode(true)` from the console makes the rest of the code behave
// normally while avoiding any network i/o.

let useMockData = location.search.includes('mock');

function createMockWordData() {
    const words = ['ma', 'ala', 'kot', 'tam', 'kota', 'flopy', 
        'skisła', 'śreżoga', 'żółtość', 'pokwitli', 'kołkująca',
        'nieuleczań', 'designerowi', 'redesignowi', 'serpentynami',
        'nieprzepysznych'];
    const map = {};
    const set = new Set(words);
    for (const w of words) {
        const key = w.split('').sort().join('');
        if (!map[key]) map[key] = [];
        map[key].push(w);
    }
    const lengthKeys = {};
    for (const k of Object.keys(map)) {
        const len = k.length;
        lengthKeys[len] = lengthKeys[len] || [];
        lengthKeys[len].push(k);
    }
    return { set, map, lengthKeys };
}

// globally accessible helpers for manual toggling from console or other
// scripts
window.setMockMode = function(enable) {
    useMockData = !!enable;
    if (useMockData) {
        cachedSetPromise = Promise.resolve(createMockWordData());
        console.log('mock word data enabled');
    } else {
        cachedSetPromise = null; // force reload on next call
        console.log('mock word data disabled');
    }
};

// ------------------------------------------------------------------------

const input = document.getElementById('inputText');
const output = document.getElementById('output');
const statusEl = document.getElementById('statusText');

const skipComments = [
    "zjebie",
    "idywiduum o skromnych horyzontach",
    "tytanem intelektu to ty (specjalnie z małej) nie jesteś",
    "7-letni chińczyk zrobiłby to lepiej",
    "czy jakieś słowo zostanie w ogóle rozwiązane?",
    "nie wiem czy to jest aż tak trudne, ale może po prostu to nie jest twoja mocna strona"
];
const incorrectChecksComments = [
    "nie, to nie jest poprawne",
    "niestety, to nie jest jedno z możliwych słów",
    "nie, spróbuj ponownie",
    "to nie jest poprawne, ale nie poddawaj się!",
    "niestety, takiego słowa nie ma w słowniku",
    "nie, to nie jest poprawne rozwiązanie"
];
const duplicatedCheckComments = [
    "to słowo już zostało znalezione, spróbuj inne",
    "już masz to słowo, poszukaj czegoś innego",
    "to słowo jest już na liście, znajdź inne",
    "to słowo już zostało odgadnięte, spróbuj innego",
    "to słowo jest już zaliczone, poszukaj innego",
    "to słowo już masz, spróbuj znaleźć inne"
];
const correctChecksComments = [
    "essa!",
    "jakbym mógł to dałbym Ci za to 67 punktów",
    "niczym poeta/ka",
    "niezły zasób słów, bratku/siostro",
    "noo i o to właśnie chodzi",
    "JEDZIEMYY!"
];

function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    const alt = document.getElementById('statusTextGame');
    if (alt) alt.textContent = msg;
    // also update loading screen status if visible
    const loading = document.getElementById('loadingStatus');
    if (loading) loading.textContent = msg;
}

function hideLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function updateLoadingProgress(percent) {
    const prog = document.getElementById('loadingProgress');
    const pageProgress = document.getElementById('progress');
    if (prog) prog.value = percent;
    if (pageProgress) pageProgress.value = percent;
}


// --- routing support for SPA ------------------------------------------------

function showSection(name) {
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(s => s.style.display = s.id === name + '-section' ? '' : 'none');
    updateGameModeUI();
    if (name === 'game') {
        // only initialize game once; subsequent navigations keep current state
        if (!gameState.letters) {
            // start game loading in background (don't block section display)
            startGame().catch(err => console.error('Game initialization failed:', err));
        }
    }
}

function navigateTo(name) {
    // redirect any "home" requests to the check page as it's now the landing screen
    if (name === 'home') name = 'game';
    location.hash = name;
    showSection(name);
}

function handleHashChange() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return navigateTo('game');
    if (['check','game'].includes(hash)) {
        showSection(hash);
    } else {
        navigateTo('game');
    }
}

window.addEventListener('hashchange', handleHashChange);

// wire nav buttons once DOM ready
let navigationSetup = false;
function setupNavigation() {
    if (navigationSetup) return;
    navigationSetup = true;
    // "home" button now acts as the check page link
    const btnCheck = document.getElementById('btn-check');
    const btnGame = document.getElementById('btn-game');
    if (btnCheck) btnCheck.addEventListener('click', () => navigateTo('check'));
    if (btnGame) btnGame.addEventListener('click', () => navigateTo('game'));
}

// --- end routing support -----------------------------------------------------

async function loadWordSet() {
    console.log('loadWordSet starting');

    // if the mock mode is enabled we can immediately return a tiny dataset
    if (useMockData) {
        updateStatus('Wczytywanie mockowego słownika');
        updateLoadingProgress(100);
        // delay
        // await new Promise(r => setTimeout(r, 50));
        return createMockWordData();
    }

    // fetch text file from same directory; make sure slowa.txt is available
    updateStatus('Pobieranie listy słów...');
    updateLoadingProgress(0);

    const resp = await fetch('slowa.txt');
    if (!resp.ok) {
        updateStatus('Nie udało się wczytać listy słów.');
        throw new Error('Unable to fetch word list');
    }

    const reader = resp.body.getReader();
    let received = 0;
    let chunks = [];
    var start = new Date().getTime();
    while (true) {
        var now = new Date().getTime();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        timePassed = (now - start) / 1000;
        updateLoadingProgress(20);
        updateStatus(`Pobieranie listy słów... (${timePassed}s)`);
    }

    const decoder = new TextDecoder();
    // combine chunks into single Uint8Array
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
    }
    const text = decoder.decode(combined);

    // sanity check
    if (!text || !text.trim()) {
        console.error('Fetched file text is empty');
        throw new Error('Word list file appears empty');
    }

    const words = text.split(/\r?\n/).filter(Boolean);
    console.log('loaded', words.length, 'words');
    
    updateStatus('Przetwarzanie słownika...');
    updateLoadingProgress(50);
    // await new Promise(r => setTimeout(r, 300));
    
    // build a dictionary mapping sorted letter sequences to word lists
    const map = {};
    const set = new Set();
    for (const w of words) {
        set.add(w);
        const key = w.split('').sort().join('');
        if (!map[key]) map[key] = [];
        map[key].push(w);
    }

    updateStatus('Optymalizowanie wyszukiwania...');
    updateLoadingProgress(75);
    // await new Promise(r => setTimeout(r, 300));
    
    // build length index to speed up game selection
    function buildLengthKeys(map) {
        const lengthKeys = {};
        for (const key of Object.keys(map)) {
            const len = key.length;
            if (!lengthKeys[len]) lengthKeys[len] = [];
            lengthKeys[len].push(key);
        }
        return lengthKeys;
    }

    const lengthKeys = buildLengthKeys(map);

    return {set, map, lengthKeys};
}

let cachedSetPromise = null;
function getWordSet() {
    if (!cachedSetPromise) {
        cachedSetPromise = loadWordSet();
    }
    return cachedSetPromise;
}

// preload word set immediately on page load so status updates are independent
async function init() {
    // prepare SPA navigation
    setupNavigation();
    
    try {
        updateStatus('Sprawdzanie pamięci podręcznej...');
        updateLoadingProgress(10);
        
        await getWordSet();
        updateLoadingProgress(100);
        
        // Show completion message briefly before hiding
        await new Promise(r => setTimeout(r, 300));
        hideLoadingScreen();
        // Initialize route AFTER hiding overlay
        handleHashChange();
    } catch (err) {
        console.error(err);
        updateStatus('Błąd przy wczytywaniu listy słów.');
        await new Promise(r => setTimeout(r, 800));
        hideLoadingScreen();
        handleHashChange();
    }
}

// run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Polish characters for wildcard expansion
const POLISH_CHARS = ['a', 'ą', 'b', 'c', 'ć', 'd', 'e', 'ę', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'ł', 'm', 'n', 'ń', 'o', 'ó', 'p', 'r', 's', 'ś', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ź', 'ż'];

// return a set of sorted-letter keys after replacing ? with all polish chars
function getWildcardKeys(str) {
    const indices = [];
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '?') indices.push(i);
    }
    const results = new Set();
    const arr = str.split('');

    function helper(pos) {
        if (pos === indices.length) {
            const key = arr.slice().sort().join('');
            results.add(key);
            return;
        }
        const idx = indices[pos];
        for (const ch of POLISH_CHARS) {
            arr[idx] = ch;
            helper(pos + 1);
        }
        arr[idx] = '?';
    }

    if (indices.length === 0) {
        // nothing to expand
        results.add(str.split('').sort().join(''));
    } else {
        helper(0);
    }
    return results;
}


// Polish plural declension
function pluralForm(count) {
    if (count === 1) return 'słowo';
    const mod10 = count % 10;
    const mod100 = count % 100;
    if ((mod100 >= 12 && mod100 <= 14) || mod10 === 0 || (mod10 >= 5 && mod10 <= 9)) {
        return 'słów';
    }
    return 'słowa';
}


input.addEventListener('input', async () => {
    const letters = input.value.trim().toLowerCase();

    if (!letters) {
        output.textContent = '';
        return;
    }

    // validate maximum 2 wildcards
    const wildcardCount = (letters.match(/\?/g) || []).length;
    if (wildcardCount > 2) {
        output.textContent = 'Dozwolone są nie więcej niż dwie blanki';
        return;
    }

    try {
        const wordData = await getWordSet();
        let matchesSet;

        if (wildcardCount === 0) {
            // simple lookup by sorted letters
            const key = letters.split('').sort().join('');
            const arr = wordData.map[key] || [];
            matchesSet = new Set(arr);
        } else {
            // expand blanks into all letter possibilities and lookup each key
            const keys = getWildcardKeys(letters);
            matchesSet = new Set();
            for (const key of keys) {
                const arr = wordData.map[key];
                if (arr && arr.length) {
                    for (const w of arr) matchesSet.add(w);
                }
            }
        }

        if (matchesSet === null) return; // search aborted
        if (matchesSet.size) {
            const form = pluralForm(matchesSet.size);
            output.textContent = `Używając wszystkie litery, można ułożyć ${matchesSet.size} ${form}.`;
        } else {
            output.textContent = 'Brak możliwych słów wykorzystujących wszystkie litery.';
        }
    } catch (err) {
        console.error(err);
        output.textContent = 'Wystąpił błąd podczas sprawdzania słów. (Coś się odjebało)';
    }
});

// --- game logic ------------------------------------------------------------

function hashStringToUint32(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createSeededRandom(seedString) {
    let state = hashStringToUint32(seedString);
    return function nextRandom() {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createRngController(seedString) {
    const random = createSeededRandom(seedString);
    return {
        seed: seedString,
        next() {
            return random();
        },
        int(maxExclusive) {
            if (maxExclusive <= 0) return 0;
            return Math.floor(random() * maxExclusive);
        }
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getTodaySeedString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getSessionSeedString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

const randomControl = {
    mode: 'normal',
    normalSeedBase: getSessionSeedString(),
    dailySeedBase: getTodaySeedString(),
    wordRng: null,
    mixRng: null
};

function configureRandomMode(mode) {
    const isDaily = mode === 'daily';
    const baseSeed = isDaily ? randomControl.dailySeedBase : randomControl.normalSeedBase;
    randomControl.mode = isDaily ? 'daily' : 'normal';
    randomControl.wordRng = createRngController(`${baseSeed}:word-sequence`);
    randomControl.mixRng = createRngController(`${baseSeed}:letter-mix`);
}

configureRandomMode('normal');

const GAME_OF_DAY_DURATION_SECONDS = 5 * 60; // 5 minutes

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

let gameOfDayState = {
    active: false,
    score: 0,
    secondsLeft: GAME_OF_DAY_DURATION_SECONDS,
    timerId: null,
    allSolutions: [],
    allFound: new Set()
};

let normalGameScore = 0;

function shuffleArray(arr, rng) {
    const randomInt = rng ? max => rng.int(max) : max => Math.floor(Math.random() * max);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function startGame() {
    // ensure words are loaded first
    try {
        const wordData = await getWordSet();
        const count = gameState.count || 7;
        await newGame(wordData, count);
    } catch (e) {
        console.error('Cannot start game', e);
    }
}

function formatTimer(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const restSeconds = safeSeconds % 60;
    return `${pad2(minutes)}:${pad2(restSeconds)}`;
}

function updateGameModeUI() {
    const startedControls = document.getElementById('started-game-controls');
    const pointsPanel = document.getElementById('points-panel');
    const gameOfDayBtn = document.getElementById('game-of-the-day');
    const gameSection = document.getElementById('game-section');
    const isOnGameSection = gameSection ? gameSection.style.display !== 'none' : false;
    const timerValue = document.getElementById('timer-value');
    const pointsValue = document.getElementById('points');
    const countButtons = document.querySelectorAll('#letterCountButtons button');

    if (startedControls) startedControls.classList.toggle('hidden', !gameOfDayState.active || !isOnGameSection);
    if (pointsPanel) pointsPanel.classList.toggle('hidden', !isOnGameSection);
    countButtons.forEach(btn => btn.disabled = gameOfDayState.active);

    if (timerValue) {
        timerValue.textContent = gameOfDayState.active
            ? formatTimer(gameOfDayState.secondsLeft)
            : '00:00';
    }
    if (pointsValue) {
        pointsValue.textContent = String(gameOfDayState.active ? gameOfDayState.score : normalGameScore);
    }

    if (gameOfDayBtn) {
        gameOfDayBtn.textContent = 'gra dnia';
        gameOfDayBtn.disabled = false;
        if (gameOfDayState.active || !isOnGameSection) {
            gameOfDayBtn.classList.add('hidden');
        } else {
            gameOfDayBtn.classList.remove('hidden');
        }
    }

    showRecentDiff(0);
}

function showRecentDiff(delta) {
    const recentDiffEl = document.getElementById('recent-difference');
    if (!recentDiffEl) return;
    if (delta === 0) {
        recentDiffEl.textContent = '';
        recentDiffEl.classList.remove('green', 'red');
        return;
    }
    const prefix = delta > 0 ? '+' : '';
    recentDiffEl.textContent = `${prefix}${delta}`;
    recentDiffEl.classList.remove('green', 'red');
    if (delta > 0) {
        recentDiffEl.classList.add('green');
    } else if (delta < 0) {
        recentDiffEl.classList.add('red');
    }
}

function updateScore(delta) {
    if (gameOfDayState.active) {
        gameOfDayState.score += delta;
    } else {
        normalGameScore += delta;
    }
    const pointsValue = document.getElementById('points');
    if (pointsValue) {
        pointsValue.textContent = String(gameOfDayState.active ? gameOfDayState.score : normalGameScore);
    }
    showRecentDiff(delta);
}

function addWordToGuessList(word, kind) {
    const guessList = document.getElementById('guessList');
    if (!guessList) return;

    // try to update existing entry from the current round instead of duplicating
    const items = Array.from(guessList.children);
    for (let i = items.length - 1; i >= 0; i--) {
        const node = items[i];
        if (node.classList && node.classList.contains('guess-separator')) break;
        const link = node.querySelector ? node.querySelector('a') : null;
        if (!link) continue;
        if (link.textContent !== word) continue;

        if (kind === 'correct') {
            link.classList.remove('guess-missed');
            link.classList.add('guess-correct');
        } else if (kind === 'missed') {
            if (!link.classList.contains('guess-correct')) {
                link.classList.add('guess-missed');
            }
        }
        return;
    }

    const div = document.createElement('div');
    div.classList.add('guess-item');

    const a = document.createElement('a');
    a.textContent = word;
    a.href = `https://sjp.pl/${encodeURIComponent(word)}`;
    a.target = '_blank';
    a.rel = 'noopener';

    if (kind === 'correct') {
        a.classList.add('guess-correct');
    } else if (kind === 'missed') {
        a.classList.add('guess-missed');
    }

    div.appendChild(a);
    guessList.appendChild(div);
}

function addRoundSeparator() {
    const guessList = document.getElementById('guessList');
    if (!guessList) return;
    const separator = document.createElement('div');
    separator.classList.add('guess-separator');
    separator.textContent = '---';
    guessList.appendChild(separator);
}

function revealMissedWordsFromCurrentRound() {
    if (gameState.roundRevealed) return;
    const missedWords = gameState.solutions.filter(word => !gameState.found.has(word));
    missedWords.forEach(word => gameState.revealedAfterGiveUp.add(word));
    missedWords.forEach(word => addWordToGuessList(word, 'missed'));
    gameState.roundRevealed = true;
}

function maybeApplySkipPenalty() {
    if (gameState.skipPenaltyApplied) return;
    const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
    gameState.skipPenaltyApplied = true;
    if (missedCount > 0) {
        updateScore(-5 * missedCount);
    }
}

function stopGameOfDayTimer() {
    if (gameOfDayState.timerId) {
        clearInterval(gameOfDayState.timerId);
        gameOfDayState.timerId = null;
    }
}

function showGameOfDayResultOverlay() {
    const overlay = document.getElementById('game-of-day-overlay');
    const scoreEl = document.getElementById('game-of-day-score');
    const wordListEl = document.getElementById('game-of-day-words-list');
    
    if (scoreEl) scoreEl.textContent = String(gameOfDayState.score);
    
    if (wordListEl) {
        wordListEl.innerHTML = '';
        gameOfDayState.allSolutions.forEach((word, idx) => {
            if (idx > 0) {
                const comma = document.createTextNode(', ');
                wordListEl.appendChild(comma);
            }
            const a = document.createElement('a');
            a.textContent = word;
            a.href = `https://sjp.pl/${encodeURIComponent(word)}`;
            a.target = '_blank';
            a.rel = 'noopener';
            const normalizedWord = word.trim().toLowerCase();
            if (gameOfDayState.allFound.has(normalizedWord)) {
                a.classList.add('guess-correct');
            } else {
                a.classList.add('guess-missed');
            }
            wordListEl.appendChild(a);
        });
    }
    if (overlay) overlay.classList.remove('hidden');
}

function hideGameOfDayResultOverlay() {
    const overlay = document.getElementById('game-of-day-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function finishGameOfDay() {
    if (!gameOfDayState.active) return;
    stopGameOfDayTimer();
    
    // Aplikuj karę za nieodgadnięte słowa z aktualnej rundy
    const missedCount = Math.max(0, gameState.solutions.length - gameState.found.size);
    if (missedCount > 0) {
        updateScore(-5 * missedCount);
    }
    
    gameOfDayState.active = false;
    updateGameModeUI();
    showGameOfDayResultOverlay();
}

function startGameOfDayTimer() {
    stopGameOfDayTimer();
    const timerValue = document.getElementById('timer-value');
    if (timerValue) timerValue.textContent = formatTimer(gameOfDayState.secondsLeft);
    gameOfDayState.timerId = setInterval(() => {
        gameOfDayState.secondsLeft -= 1;
        if (timerValue) timerValue.textContent = formatTimer(gameOfDayState.secondsLeft);
        if (gameOfDayState.secondsLeft <= 0) {
            finishGameOfDay();
        }
    }, 1000);
}

async function startGameOfDay() {
    hideGameOfDayResultOverlay();
    // Clear the guesses list at the start of game of day
    const guessList = document.getElementById('guessList');
    if (guessList) {
        while (guessList.firstChild) {
            guessList.removeChild(guessList.firstChild);
        }
    }
    configureRandomMode('daily');
    gameOfDayState.active = true;
    gameOfDayState.score = 0;
    gameOfDayState.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
    gameOfDayState.allSolutions = [];
    gameOfDayState.allFound.clear();
    showRecentDiff(0);
    updateGameModeUI();
    gameState.count = 7;
    const wordData = await getWordSet();
    await newGame(wordData, 7);
    startGameOfDayTimer();
}

async function returnToNormalMode() {
    stopGameOfDayTimer();
    gameOfDayState.active = false;
    gameOfDayState.secondsLeft = GAME_OF_DAY_DURATION_SECONDS;
    hideGameOfDayResultOverlay();
    configureRandomMode('normal');
    updateGameModeUI();
    await startGame();
}

async function newGame(wordData, count) {
    gameState.count = count;
    gameState.roundNumber += 1;
    if (gameOfDayState.active) {
        const guessList = document.getElementById('guessList');
        if (guessList && guessList.children.length > 0) {
            addRoundSeparator();
        }
        // Limit guess list size to prevent memory issues
        if (guessList && guessList.children.length > 200) {
            while (guessList.children.length > 150) {
                guessList.removeChild(guessList.firstChild);
            }
        }
    }
    // choose random key of correct length using precomputed index
    const keys = (wordData.lengthKeys && wordData.lengthKeys[count]) ? wordData.lengthKeys[count] :
                  Object.keys(wordData.map).filter(k => k.length === count);
    if (!keys || keys.length === 0) {
        document.getElementById('letterDisplay').textContent = 'Brak słów o takiej długości';
        document.getElementById('solutionCount').textContent = '0';
        gameState.letters = '';
        gameState.solutions = [];
        gameState.found.clear();
        gameState.revealedAfterGiveUp.clear();
        gameState.skipPenaltyApplied = false;
        gameState.roundRevealed = false;
        if (!gameOfDayState.active) {
            const list = document.getElementById('guessList');
            if (list) {
                while (list.firstChild) {
                    list.removeChild(list.firstChild);
                }
            }
        }
        return;
    }
    const key = keys[randomControl.wordRng.int(keys.length)];
    const letters = shuffleArray(key.split(''), randomControl.mixRng).join('');
    const solutions = Array.from(new Set(wordData.map[key] || [])).sort();
    gameState.letters = letters;
    gameState.solutions = solutions;
    gameState.found.clear();
    gameState.revealedAfterGiveUp.clear();
    gameState.skipPenaltyApplied = false;
    gameState.roundRevealed = false;
    if (gameOfDayState.active) {
        gameState.solutions.forEach(w => gameOfDayState.allSolutions.push(w));
    }
    updateGameUI();
}

function renderLetterTiles() {
    const display = document.getElementById('letterDisplay');
    const literakiData = new LiterakiData();
    
    // Only full rerender if tile count changed or tiles were never created
    const needsFullRerender = tileElements.length !== gameState.letters.length || tileElements.length === 0;
    
    if (needsFullRerender) {
        // Clean up old tiles from DOM and cache
        tileElements.forEach(tile => {
            tile.removeEventListener('pointerdown', tilePointerDown);
        });
        
        // Clear display container
        while (display.firstChild) {
            display.removeChild(display.firstChild);
        }
        tileElements = [];
        
        gameState.letters.split('').forEach((ch, idx) => {
            const span = document.createElement('span');
            span.className = 'letter-tile';
            if (draggingIndex === idx) span.classList.add('dragging');
            span.textContent = ch.toUpperCase();
            const points = literakiData.getLetterPoint(ch);
            switch (points) {
                case 1: span.classList.add('yellow-letter'); break;
                case 2: span.classList.add('green-letter'); break;
                case 3: span.classList.add('blue-letter'); break;
                case 5: span.classList.add('red-letter'); break;
                default: break;
            }
            span.dataset.index = idx;
            span.addEventListener('pointerdown', tilePointerDown);
            display.appendChild(span);
            tileElements.push(span);
        });
    } else {
        // Efficient update: update content and styles of existing tiles
        gameState.letters.split('').forEach((ch, idx) => {
            if (tileElements[idx]) {
                tileElements[idx].textContent = ch.toUpperCase();
                const points = literakiData.getLetterPoint(ch);
                // Reset color classes
                tileElements[idx].classList.remove('yellow-letter', 'green-letter', 'blue-letter', 'red-letter');
                switch (points) {
                    case 1: tileElements[idx].classList.add('yellow-letter'); break;
                    case 2: tileElements[idx].classList.add('green-letter'); break;
                    case 3: tileElements[idx].classList.add('blue-letter'); break;
                    case 5: tileElements[idx].classList.add('red-letter'); break;
                }
                tileElements[idx].classList.remove('dragging');
                if (draggingIndex === idx) tileElements[idx].classList.add('dragging');
            }
        });
    }
}

// global state for pointer dragging
let draggingIndex = null;
let floatingEl = null;
let tileElements = []; // cache of tile elements for efficient updates during drag

// helper to swap letters in gameState and update display
function swapLetters(i, j) {
    const arr = gameState.letters.split('');
    const [letter] = arr.splice(i, 1);
    arr.splice(j, 0, letter);
    gameState.letters = arr.join('');
}

function tilePointerDown(e) {
    // Prevent scrolling and selection during drag
    document.body.style.touchAction = 'none';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    const idx = parseInt(this.dataset.index, 10);
    draggingIndex = idx;

    // create a floating clone WITHOUT deep cloning to avoid copying listeners
    floatingEl = document.createElement('span');
    floatingEl.className = 'letter-tile floating';
    floatingEl.textContent = this.textContent;
    // copy style classes for visual consistency
    Array.from(this.classList).forEach(cls => {
        if (cls !== 'letter-tile' && cls !== 'dragging') {
            floatingEl.classList.add(cls);
        }
    });
    document.body.appendChild(floatingEl);
    moveFloating(e);

    // Mark original tiles with dragging state via CSS class instead of recreating
    tileElements.forEach((tile, i) => {
        tile.classList.toggle('dragging', i === idx);
    });

    // listeners on window so they persist even if tile is re-rendered
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerUp, { passive: false });
}

function moveFloating(e) {
    if (!floatingEl) return;
    // position centered under pointer
    const x = e.pageX - floatingEl.offsetWidth / 2;
    const y = e.pageY - floatingEl.offsetHeight / 2;
    floatingEl.style.left = x + 'px';
    floatingEl.style.top = y + 'px';
}

function onPointerMove(e) {
    moveFloating(e);
    const elem = document.elementFromPoint(e.clientX, e.clientY);
    if (elem && elem.classList.contains('letter-tile') && !elem.classList.contains('floating')) {
        const dst = parseInt(elem.dataset.index, 10);
        if (dst !== draggingIndex) {
            swapLetters(draggingIndex, dst);
            // Rebuild display from gameState to ensure sync
            rebuildTilesFromGameState(dst);
            draggingIndex = dst;
            // handleGuess(gameState.letters); // auto-check disabled, use button
        }
    }
}

function rebuildTilesFromGameState(dragIdx) {
    // Rebuild all tile displays from gameState.letters, keeping DOM nodes in place
    if (tileElements.length !== gameState.letters.length) return; // shouldn't happen but safety check
    
    const literakiData = new LiterakiData();
    gameState.letters.split('').forEach((ch, idx) => {
        const tile = tileElements[idx];
        if (!tile) return;
        
        // Update text and styling from gameState
        tile.textContent = ch.toUpperCase();
        tile.dataset.index = idx;
        
        // Reset color classes
        tile.classList.remove('yellow-letter', 'green-letter', 'blue-letter', 'red-letter');
        const points = literakiData.getLetterPoint(ch);
        switch (points) {
            case 1: tile.classList.add('yellow-letter'); break;
            case 2: tile.classList.add('green-letter'); break;
            case 3: tile.classList.add('blue-letter'); break;
            case 5: tile.classList.add('red-letter'); break;
        }
        
        // Update dragging state
        tile.classList.toggle('dragging', idx === dragIdx);
    });
}

function onPointerUp(e) {
    // Restore scrolling and selection
    document.body.style.touchAction = '';
    document.body.style.userSelect = '';
    
    // Remove listeners from window (use { passive: false } to match how they were added)
    window.removeEventListener('pointermove', onPointerMove, { passive: false });
    window.removeEventListener('pointerup', onPointerUp, { passive: false });
    window.removeEventListener('pointercancel', onPointerUp, { passive: false });
    
    // Clean up floating element
    if (floatingEl && floatingEl.parentNode) {
        floatingEl.parentNode.removeChild(floatingEl);
    }
    floatingEl = null;
    
    // Remove dragging class from all tiles
    tileElements.forEach(tile => tile.classList.remove('dragging'));
    draggingIndex = null;
}


function updateGameUI() {
    // original textual display replaced by interactive tiles (pointer drag)
    document.getElementById('solutionCount').textContent = gameState.solutions.length;
    const guessList = document.getElementById('guessList');
    if (!gameOfDayState.active) {
        // Properly clear all child nodes to ensure cleanup
        while (guessList && guessList.firstChild) {
            guessList.removeChild(guessList.firstChild);
        }
    }
    // Reset tile cache when starting new game
    tileElements = [];
    draggingIndex = null;
    const correctSection = document.getElementById('correctSection');
    if (gameState.found.size > 0 || guessList.children.length > 0) {
        correctSection.classList.remove('hidden');
    } else {
        correctSection.classList.add('hidden');
    }
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.value = '';
        guessInput.style.backgroundColor = '';
        // hide text input when using drag interface
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
        updateScore(50);
        if (gameOfDayState.active) {
            gameOfDayState.allFound.add(normalized);
        }
        addWordToGuessList(normalized, 'correct');
        // keep the input text so player can continue editing
        const correctSection = document.getElementById('correctSection');
        if (gameState.found.size > 0) {
            correctSection.classList.remove('hidden');
        } else {
            correctSection.classList.add('hidden');
        }
        confettiSeries();
        if (gameOfDayState.active && gameState.found.size === gameState.solutions.length) {
            const count = gameState.count || 7;
            try {
                const wordData = await getWordSet();
                await newGame(wordData, count);
            } catch (e) {
                console.error('Cannot generate next game', e);
            }
        }
    } else {
        triggerShake('letter-tile');
    }
}

function confettiSeries() {
    const count = 2; // number of confetti bursts
    let totalDelay = 0;
    delayProfile = [200];
    for (let i = 0; i < count; i++) {
        setTimeout(fireConfetti, totalDelay);
        let delay = delayProfile[i % delayProfile.length];
        totalDelay += delay;
    }
}

function fireConfetti(){
    relativePosition = getRelativeCoordinatesOnScreen('correctSection');
    var defaults = {
        spread: 55,
        colors: ['#43B243', '#DEB617', '#537AD5', '#D56253'],
        startVelocity: 30,
        particleCount: 100,
    };
    confetti({
        ...defaults,
        angle: 45,
        origin: { x: 0, y: relativePosition.y }
    });
    confetti({
        ...defaults,
        angle: 135,
        origin: { x: 1, y: relativePosition.y }
    });
}

function triggerShake(className) {
    const elements = document.getElementsByClassName(className);
    if (!elements || elements.length === 0) return;
    for (const el of elements) {
        // Remove any existing animationend listeners by cloning the node
        el.classList.remove("shake");
        // trigger reflow to restart animation
        void el.offsetWidth;
        el.classList.add("shake");

        // Use a named function so we can properly remove it if needed
        const removeShake = () => {
            el.classList.remove("shake");
        };
        el.addEventListener("animationend", removeShake, { once: true });
    }
}

function getRelativeCoordinatesOnScreen(elementName) {
    const element = document.getElementById(elementName);
    const rect = element.getBoundingClientRect();
    viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const x = rect.left/viewportWidth + (rect.width / 2) / viewportWidth;
    const y = rect.top/viewportHeight + (rect.height / 2) / viewportHeight;
    return { x, y };
}

// hook up game controls once DOM ready
let gameControlsSetup = false;
function setupGameControls() {
    if (gameControlsSetup) return;
    gameControlsSetup = true;
    
    updateGameModeUI();
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        // keep the existing listener around in case we ever re-enable the field
        guessInput.addEventListener('input', () => {
            handleGuess(guessInput.value);
        });
        // hide text input when pointer drag interface is available
        guessInput.style.display = 'none';
    }
    const checkBtn = document.getElementById('checkBtn');
    if (checkBtn) {
        checkBtn.addEventListener('click', () => {
            handleGuess(gameState.letters);
        });
    }
    const giveUp = document.getElementById('giveUpBtn');
    if (giveUp) {
        giveUp.addEventListener('click', () => {
            maybeApplySkipPenalty();
            if (!gameOfDayState.active) {
                const list = document.getElementById('guessList');
                // Properly clear old nodes
                while (list.firstChild) {
                    list.removeChild(list.firstChild);
                }
                gameState.solutions.forEach(w => {
                    const kind = gameState.found.has(w) ? 'correct' : 'missed';
                    if (kind === 'missed') gameState.revealedAfterGiveUp.add(w);
                    addWordToGuessList(w, kind);
                });
                gameState.roundRevealed = true;
            } else {
                revealMissedWordsFromCurrentRound();
            }
            const correctSection = document.getElementById('correctSection');
            correctSection.classList.remove('hidden');
        });
    }
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
            maybeApplySkipPenalty();
            if (gameOfDayState.active) {
                revealMissedWordsFromCurrentRound();
            }
            const count = gameState.count || 7;
            try {
                const wordData = await getWordSet();
                await newGame(wordData, count);
            } catch (e) {
                console.error('Cannot generate next game', e);
            }
        });
    }
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => {
            // reshuffle current letters order without clearing user's guess
            if (gameState.letters) {
                gameState.letters = shuffleArray(gameState.letters.split(''), randomControl.mixRng).join('');
                renderLetterTiles();
            }
        });
    }

    const gameOfDayBtn = document.getElementById('game-of-the-day');
    if (gameOfDayBtn) {
        gameOfDayBtn.addEventListener('click', async () => {
            try {
                await startGameOfDay();
            } catch (e) {
                console.error('Cannot start game of the day', e);
            }
        });
    }

    const stopGameBtn = document.getElementById('stop-game');
    if (stopGameBtn) {
        stopGameBtn.addEventListener('click', async () => {
            if (!gameOfDayState.active) return;
            await returnToNormalMode();
        });
    }

    const gameOfDayReturnBtn = document.getElementById('game-of-day-return');
    if (gameOfDayReturnBtn) {
        gameOfDayReturnBtn.addEventListener('click', async () => {
            await returnToNormalMode();
        });
    }

    const btn6Count = document.getElementById('Btn6');
    const btn7Count = document.getElementById('Btn7');
    const btn8Count = document.getElementById('Btn8');
    const btn9Count = document.getElementById('Btn9');
    let countButtons = [btn6Count, btn7Count, btn8Count, btn9Count];
    if (btn6Count) {
        btn6Count.addEventListener('click', () => {
            handleCountSelect(6, btn6Count, countButtons);
        });
    }
    if (btn7Count) {
        btn7Count.addEventListener('click', () => {
            handleCountSelect(7, btn7Count, countButtons);
        });
    }
    if (btn8Count) {
        btn8Count.addEventListener('click', () => {
            handleCountSelect(8, btn8Count, countButtons);
        });
    }
    if (btn9Count) {
        btn9Count.addEventListener('click', () => {
            handleCountSelect(9, btn9Count, countButtons);
        });
    }
}

function handleCountSelect(count, selectedButton, countButtons) {
    countButtons.forEach(btn => btn.classList.remove('chosen'));
    selectedButton.classList.add('chosen');
    gameState.count = count;
    startGame();
}

// ensure game controls initialized during global init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGameControls);
} else {
    setupGameControls();
}

// --- end game logic --------------------------------------------------------

// --- statistics functions for fun and profit -------------------------------
async function getWordWithMostAnagrams() {
    const wordData = await getWordSet();
    let maxCount = 0;
    let maxKey = null;
    for (const key of Object.keys(wordData.map)) {
        const count = wordData.map[key].length;
        if (count > maxCount) {
            maxCount = count;
            maxKey = key;
        }
    }
    return { key: maxKey, count: maxCount, words: wordData.map[maxKey] };
}

async function getEveryWordWithEveryPointsLetter(letterCount) {
    // gets a list of words that contain at least one letter for each point
    // value (1,2,3,5) and returns the list sorted by total score, highest
    // first
    const wordData = await getWordSet();
    const literakiData = new LiterakiData();
    const matchingWords = [];
    
    for (const key of Object.keys(wordData.map)) {
        const words = wordData.map[key];
        for (const w of words) {
            if (w.length !== letterCount) continue;
            let wordScore = 0;
            let onePointerPresent = false;
            let twoPointerPresent = false;
            let threePointerPresent = false;
            let fivePointerPresent = false;
            
            for (const ch of w) {
                const points = literakiData.getLetterPoint(ch);
                switch (points) {
                    case 1: onePointerPresent = true; break;
                    case 2: twoPointerPresent = true; break;
                    case 3: threePointerPresent = true; break;
                    case 5: fivePointerPresent = true; break;
                }
                wordScore += points;
            }
            
            const presentScore = 
              (onePointerPresent ? 1 : 0) +
              (twoPointerPresent ? 1 : 0) +
              (threePointerPresent ? 1 : 0) +
              (fivePointerPresent ? 1 : 0);
              
            if (presentScore === 4) {
                matchingWords.push({ word: w, score: wordScore });
            }
        }
    }
    
    // Sort by score, highest first
    matchingWords.sort((a, b) => b.score - a.score);
    
    return matchingWords;
}

async function getEveryWordPoints(letterCount) {
    const wordData = await getWordSet();
    const literakiData = new LiterakiData();
    const matchingWords = [];
    
    for (const key of Object.keys(wordData.map)) {
        const words = wordData.map[key];
        for (const w of words) {
            if (w.length !== letterCount) continue;
            let wordScore = 0;
            
            for (const ch of w) {
                const points = literakiData.getLetterPoint(ch);
                wordScore += points;
            }
            usedCharsCountMap = {};
            for (const ch of w) {
              usedCharsCountMap[ch] = (usedCharsCountMap[ch] || 0) + 1;
            }
            for (const ch in usedCharsCountMap) {
              const isEnough = 
                usedCharsCountMap[ch] <= literakiData.getLetterCount(ch);
              if (!isEnough) {
                wordScore = -1;
                break;
              }
            }
            
            if (wordScore !== -1) {
                matchingWords.push({ word: w, score: wordScore });
            }
        }
    }
    
    // Sort by score, highest first
    matchingWords.sort((a, b) => b.score - a.score);
    
    return matchingWords;
}

async function getMostValuableWordOfLength(length) {
    const wordData = await getWordSet();
    const literakiData = new LiterakiData();
    let maxScore = 0;
    let bestWord = null;
    for (const key of Object.keys(wordData.map)) {
        const words = wordData.map[key];
        for (const w of words) {
            if (w.length !== length) continue;
            let wordScore = 0;
            for (const ch of w) {
                wordScore += literakiData.getLetterPoint(ch);
            }
            if (wordScore > maxScore) {
                maxScore = wordScore;
                bestWord = w;
            }
        }
    }
    return { word: bestWord, score: maxScore };
}

async function getWordsListWithXVowels(vowelCount, wordLength) {
    const wordData = await getWordSet();
    const literakiData = new LiterakiData();
    const matchingWords = [];
    for (const key of Object.keys(wordData.map)) {
        const words = wordData.map[key];
        for (const w of words) {
            if (w.length !== wordLength) continue;
            let count = 0;
            for (const ch of w) {
                if (literakiData.isVowel.has(ch.toUpperCase())) {
                    count++;
                }
            }
            if (count == vowelCount) {
                matchingWords.push(w);
            }
        }
    }
    return matchingWords;
}

async function convertWordSetToProcessedData() {
    console.log('loadWordSet starting');

    // fetch text file from same directory; make sure slowa.txt is available
    const resp = await fetch('slowa.txt');
    if (!resp.ok) {
        throw new Error('Unable to fetch word list');
    }

    const reader = resp.body.getReader();
    let received = 0;
    let chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
    }

    const decoder = new TextDecoder();
    // combine chunks into single Uint8Array
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
    }
    const text = decoder.decode(combined);

    // sanity check
    if (!text || !text.trim()) {
        console.error('Fetched file text is empty');
        throw new Error('Word list file appears empty');
    }

    const words = text.split(/\r?\n/).filter(Boolean);
    console.log('loaded', words.length, 'words');
    
    // build a dictionary mapping sorted letter sequences to word lists

    const wordsArray = new Array();
    const anagramMap = new Map();
    let indexOfWord = 0;
    for (const w of words) {
        wordsArray.push(w);
        const key = w.split('').sort().join('');
        if (!anagramMap.has(key)) anagramMap.set(key, []);
        anagramMap.get(key).push(indexOfWord);
        indexOfWord++;
    }

    const lengthKeys = {};
    let indexOfKeyInMap = 0;
    for (const key of anagramMap.keys()) {
        const len = key.length;
        if (!lengthKeys[len]) lengthKeys[len] = [];
        lengthKeys[len].push(indexOfKeyInMap);
        indexOfKeyInMap++;
    }
    return {wordsArray, anagramMap, lengthKeys};
}



// TODO:
// - karta ze statystykami: 
//  - częstość liter
//  - najczęstsze początki/końcówki dla konkretnych długości wyrazów
//  - rozkład ilościowy stosunku spółgłosek do samogłosek w wyrazach konkretnych długości