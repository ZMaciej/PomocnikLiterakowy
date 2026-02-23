const input = document.getElementById('inputText');
const output = document.getElementById('output');
const statusEl = document.getElementById('statusText');


// --- routing support for SPA ------------------------------------------------

function showSection(name) {
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(s => s.style.display = s.id === name + '-section' ? '' : 'none');
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

    // kolejne odwiedziny w jednej sesji: najpierw sprawdzamy sessionStorage
    // w którym zapisujemy wyłącznie strukturę map. Przy odczycie tworzymy
    // dodatkowo Set, bo JSON nie obsługuje typów specjalnych.
    const cached = sessionStorage.getItem('wordData');
    if (cached) {
        statusEl.textContent = 'Lista słów pobrana z pamięci sesyjnej.';
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
        statusEl.textContent = 'Lista słów wczytana z pamięci podręcznej.';
        // zapisz minimalną strukturę (map) w sessionStorage
        try {
            const copy = { map: data.map };
            sessionStorage.setItem('wordData', JSON.stringify(copy));
        } catch {}
        return data;
    }

    // fetch text file from same directory; make sure slowa.txt is available
    statusEl.textContent = 'Pobieranie listy słów...';
    const progressElem = document.getElementById('progress');
    progressElem.style.display = 'block';
    progressElem.value = 0;

    const resp = await fetch('slowa.txt');
    if (!resp.ok) {
        statusEl.textContent = 'Nie udało się wczytać listy słów.';
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
            statusEl.textContent = `Pobieranie listy słów... (${percent}%)`;
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

    const tx2 = db.transaction('words', 'readwrite');
    tx2.objectStore('words').put({set, map}, 'data');
    statusEl.textContent = 'Lista słów pobrana i zapisana w pamięci podręcznej.';
    return {set, map};
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
        statusEl.textContent = 'Błąd przy wczytywaniu listy słów.';
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
        statusEl.textContent = 'Czyszczenie pamięci podręcznej...';        // remove sessionStorage data
        sessionStorage.removeItem('wordData');        // delete indexeddb database
        const deleteReq = indexedDB.deleteDatabase('LiterakowyDB');
        deleteReq.onsuccess = () => {
            statusEl.textContent = 'Pamięć podręczna wyczyszczona.';
            cachedSetPromise = null;
        };
        deleteReq.onerror = () => {
            statusEl.textContent = 'Nie udało się wyczyścić pamięci podręcznej.';
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
