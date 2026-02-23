const input = document.getElementById('inputText');
const output = document.getElementById('output');
const statusEl = document.getElementById('statusText');

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
    if (name === 'home') name = 'check';
    location.hash = name;
    showSection(name);
}

function handleHashChange() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return navigateTo('check');
    if (['check','game'].includes(hash)) {
        showSection(hash);
    } else {
        navigateTo('check');
    }
}

window.addEventListener('hashchange', handleHashChange);

// wire nav buttons once DOM ready
function setupNavigation() {
    // "home" button now acts as the check page link
    document.getElementById('btn-home').addEventListener('click', () => navigateTo('check'));
    document.getElementById('btn-game').addEventListener('click', () => navigateTo('game'));
}

// --- end routing support -----------------------------------------------------


async function loadWordSet() {
    console.log('loadWordSet starting');

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
    const contentLength = resp.headers.get('Content-Length');
    let received = 0;
    let chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) {
            const percent = Math.floor((received / contentLength) * 100);
            updateLoadingProgress(percent);
            updateStatus(`Pobieranie listy słów... (${percent}%)`);
        }
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
        const count = parseInt(document.getElementById('letterCount').value, 10) || 7;
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

function updateGameUI() {
    document.getElementById('letterDisplay').textContent = gameState.letters.split('').join(' ');
    document.getElementById('solutionCount').textContent = gameState.solutions.length;
    const guessList = document.getElementById('guessList');
    guessList.innerHTML = '';
    const guessInput = document.getElementById('guessInput');
    guessInput.value = '';
    guessInput.style.backgroundColor = '';
}

function handleGuess(guess) {
    const normalized = guess.trim().toLowerCase();
    if (!normalized) return;
    const guessInput = document.getElementById('guessInput');
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
        guessInput.style.backgroundColor = 'lightgreen';
        // keep the input text so player can continue editing
    } else {
        guessInput.style.backgroundColor = '';
    }
}

// hook up game controls once DOM ready
function setupGameControls() {
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        // check after every keystroke
        guessInput.addEventListener('input', () => {
            handleGuess(guessInput.value);
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
        });
    }
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
            const count = parseInt(document.getElementById('letterCount').value, 10) || 7;
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
                // only update the display of letters
                document.getElementById('letterDisplay').textContent = gameState.letters.split('').join(' ');
            }
        });
    }
}

// ensure game controls initialized during global init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGameControls);
} else {
    setupGameControls();
}

// --- end game logic --------------------------------------------------------
