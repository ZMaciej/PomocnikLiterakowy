const input = document.getElementById('inputText');
const output = document.getElementById('output');
const statusEl = document.getElementById('statusText');

function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    const alt = document.getElementById('statusTextGame');
    if (alt) alt.textContent = msg;
}


// --- routing support for SPA ------------------------------------------------

function showSection(name) {
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(s => s.style.display = s.id === name + '-section' ? '' : 'none');
    if (name === 'game') {
        // only initialize game once; subsequent navigations keep current state
        if (!gameState.letters) {
            startGame();
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


// IndexedDB helpers
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('LiterakowyDB', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('words')) {
                db.createObjectStore('words');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

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

    // kolejne odwiedziny w jednej sesji: najpierw sprawdzamy sessionStorage
    // w którym zapisujemy wyłącznie strukturę map oraz indeks długości. Przy
    // odczycie tworzymy dodatkowo Set, bo JSON nie obsługuje typów specjalnych.
    const cached = sessionStorage.getItem('wordData');
    if (cached) {
        updateStatus('Lista słów pobrana z pamięci sesyjnej.');
        try {
            const obj = JSON.parse(cached);
            // sprawdz czy map istnieje
            if (!obj.map) throw new Error('Invalid cached data: missing map');
            // rekonstrukcja "set" z map
            const set = new Set();
            for (const arr of Object.values(obj.map || {})) {
                for (const w of arr) set.add(w);
            }
            obj.set = set;
            // odbuduj indeks długości jeśli brak
            if (!obj.lengthKeys) obj.lengthKeys = buildLengthKeys(obj.map);
            return obj;
        } catch (e) {
            sessionStorage.removeItem('wordData');
        }
    }

    const db = await openDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    const data = await new Promise((res, rej) => {
        const r = store.get('data');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });

    if (data) {
        updateStatus('Lista słów wczytana z pamięci podręcznej.');
        // ensure length index available
        if (!data.lengthKeys) data.lengthKeys = buildLengthKeys(data.map);
        // zapisz minimalną strukturę (map + lengthKeys) w sessionStorage
        try {
            const copy = { map: data.map, lengthKeys: data.lengthKeys };
            sessionStorage.setItem('wordData', JSON.stringify(copy));
        } catch {}
        return data;
    }

    // fetch text file from same directory; make sure slowa.txt is available
    updateStatus('Pobieranie listy słów...');
    const progressElem = document.getElementById('progress');
    progressElem.style.display = 'block';
    progressElem.value = 0;

    const resp = await fetch('slowa.txt');
    if (!resp.ok) {
        updateStatus('Nie udało się wczytać listy słów.');
        progressElem.style.display = 'none';
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
            progressElem.value = percent;
            updateStatus(`Pobieranie listy słów... (${percent}%)`);
        }
    }
    progressElem.style.display = 'none';

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
    const map = {};
    const set = new Set();
    for (const w of words) {
        set.add(w);
        const key = w.split('').sort().join('');
        if (!map[key]) map[key] = [];
        map[key].push(w);
    }

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

    const tx2 = db.transaction('words', 'readwrite');
    tx2.objectStore('words').put({set, map, lengthKeys}, 'data');
    updateStatus('Lista słów pobrana i zapisana w pamięci podręcznej.');
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
    handleHashChange();

    try {
        await getWordSet();
    } catch (err) {
        console.error(err);
        updateStatus('Błąd przy wczytywaniu listy słów.');
    }
}

// run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// clear cached data handler
const clearBtn = document.getElementById('clearCacheBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
        updateStatus('Czyszczenie pamięci podręcznej...');        // remove sessionStorage data
        sessionStorage.removeItem('wordData');        // delete indexeddb database
        const deleteReq = indexedDB.deleteDatabase('LiterakowyDB');
        deleteReq.onsuccess = () => {
            updateStatus('Pamięć podręczna wyczyszczona.');
            cachedSetPromise = null;
        };
        deleteReq.onerror = () => {
            updateStatus('Nie udało się wyczyścić pamięci podręcznej.');
        };
    });
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
