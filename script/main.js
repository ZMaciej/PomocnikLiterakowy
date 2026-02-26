// ---- mock helpers -------------------------------------------------------
// a tiny fake dictionary that can be swapped in during UI work.  the
// real loader is expensive so appending "?mock" to the URL or calling
// `setMockMode(true)` from the console makes the rest of the code behave
// normally while avoiding any network i/o.

let useMockData = location.search.includes('mock');

function createMockWordData() {
    const words = ['ma', 'ala', 'kot', 'tam', 'kota', 'flopy', 'skisła', 'śreżoga', 'pokwitli', 'kołkująca', 'nieuleczań', 'designerowi', 'redesignowi', 'serpentynami', 'nieprzepysznych'];
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
    "ten przycisk był tylko do testów, ale spoko, używaj go aż się popsuje",
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
    "JAZDAAA!"
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
    const overlay = document.getElementById('loadingOverlay');
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
function setupNavigation() {
    // "home" button now acts as the check page link
    document.getElementById('btn-check').addEventListener('click', () => navigateTo('check'));
    document.getElementById('btn-game').addEventListener('click', () => navigateTo('game'));
}

// --- end routing support -----------------------------------------------------


async function loadWordSet() {
    console.log('loadWordSet starting');

    // if the mock mode is enabled we can immediately return a tiny dataset
    if (useMockData) {
        updateStatus('Wczytywanie mockowego słownika');
        updateLoadingProgress(100);
        // make a short delay so UI still has a chance to render status
        await new Promise(r => setTimeout(r, 50));
        return createMockWordData();
    }

    function buildLengthKeys(map) {
        const lengthKeys = {};
        for (const key of Object.keys(map)) {
            const len = key.length;
            if (!lengthKeys[len]) lengthKeys[len] = [];
            lengthKeys[len].push(key);
        }
        return lengthKeys;
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
    await new Promise(r => setTimeout(r, 300));
    
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
    await new Promise(r => setTimeout(r, 300));
    
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

let gameState = {
    letters: '',
    solutions: [],
    found: new Set(),
    count: 7
};

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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

async function newGame(wordData, count) {
    gameState.count = count;
    // choose random key of correct length using precomputed index
    const keys = (wordData.lengthKeys && wordData.lengthKeys[count]) ? wordData.lengthKeys[count] :
                 Object.keys(wordData.map).filter(k => k.length === count);
    if (!keys || keys.length === 0) {
        document.getElementById('letterDisplay').textContent = 'Brak słów o takiej długości';
        document.getElementById('solutionCount').textContent = '0';
        gameState.letters = '';
        gameState.solutions = [];
        gameState.found.clear();
        return;
    }
    const key = keys[Math.floor(Math.random() * keys.length)];
    const letters = shuffleArray(key.split('')).join('');
    const solutions = Array.from(new Set(wordData.map[key] || [])).sort();
    gameState.letters = letters;
    gameState.solutions = solutions;
    gameState.found.clear();
    updateGameUI();
}

function renderLetterTiles() {
    const display = document.getElementById('letterDisplay');
    display.innerHTML = '';
    gameState.letters.split('').forEach((ch, idx) => {
        const span = document.createElement('span');
        span.className = 'letter-tile';
        if (draggingIndex === idx) span.classList.add('dragging');
        span.textContent = ch;
        span.dataset.index = idx;
        // start manual drag via pointer
        span.addEventListener('pointerdown', tilePointerDown);

        display.appendChild(span);
    });
}

// global state for pointer dragging
let draggingIndex = null;
let floatingEl = null;

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

    // create a floating clone for the dragged tile
    floatingEl = this.cloneNode(true);
    floatingEl.classList.add('letter-tile', 'floating');
    document.body.appendChild(floatingEl);
    moveFloating(e);

    // hide the original via rendering (it will get .dragging)
    renderLetterTiles();

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
                draggingIndex = dst;
                renderLetterTiles();
                // handleGuess(gameState.letters); // auto-check disabled, use button
            }
        }
}

function onPointerUp(e) {
        // Restore scrolling and selection
        document.body.style.touchAction = '';
        document.body.style.userSelect = '';
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    // remove listeners from window
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (floatingEl && floatingEl.parentNode) floatingEl.parentNode.removeChild(floatingEl);
    floatingEl = null;
    draggingIndex = null;
    renderLetterTiles();
}


function updateGameUI() {
    // original textual display replaced by interactive tiles (pointer drag)
    document.getElementById('solutionCount').textContent = gameState.solutions.length;
    const guessList = document.getElementById('guessList');
    guessList.innerHTML = '';
    const correctSection = document.getElementById('correctSection');
    if (gameState.found.size > 0) {
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

function handleGuess(guess) {
    const normalized = guess.trim().toLowerCase();
    if (!normalized) return;
    if (gameState.solutions.includes(normalized) && !gameState.found.has(normalized)) {
        gameState.found.add(normalized);
        const a = document.createElement('a');
        a.textContent = normalized;
        a.href = `https://sjp.pl/${encodeURIComponent(normalized)}`;
        a.target = '_blank';
        a.rel = 'noopener';
        const div = document.createElement('div');
        div.appendChild(a);
        document.getElementById('guessList').appendChild(div);
        // keep the input text so player can continue editing
        const correctSection = document.getElementById('correctSection');
        if (gameState.found.size > 0) {
            correctSection.classList.remove('hidden');
        } else {
            correctSection.classList.add('hidden');
        }
        confettiSeries();
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
function setupGameControls() {
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
            const list = document.getElementById('guessList');
            list.innerHTML = '';
            gameState.solutions.forEach(w => {
                const a = document.createElement('a');
                a.textContent = w;
                a.href = `https://sjp.pl/${encodeURIComponent(w)}`;
                a.target = '_blank';
                a.rel = 'noopener';
                const div = document.createElement('div');
                div.appendChild(a);
                list.appendChild(div);
            });
            const correctSection = document.getElementById('correctSection');
            correctSection.classList.remove('hidden');
        });
    }
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
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
                gameState.letters = shuffleArray(gameState.letters.split('')).join('');
                renderLetterTiles();
                handleGuess(gameState.letters);
            }
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

// TODO:
// - seria dnia do zgadnięcia w minigrze
// - karta ze statystykami: 
//  - częstość liter
//  - najczęstsze początki/końcówki dla konkretnych długości wyrazów
//  - rozkład ilościowy stosunku spółgłosek do samogłosek w wyrazach konkretnych długości