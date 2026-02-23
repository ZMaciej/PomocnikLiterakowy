const input = document.getElementById('inputText');
const output = document.getElementById('output');
const statusEl = document.getElementById('statusText');


// --- routing support for SPA ------------------------------------------------

function showSection(name) {
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(s => s.style.display = s.id === name + '-section' ? '' : 'none');
}

function navigateTo(name) {
    location.hash = name;
    showSection(name);
}

function handleHashChange() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return navigateTo('home');
    if (['home','check','game'].includes(hash)) {
        showSection(hash);
    } else {
        navigateTo('home');
    }
}

window.addEventListener('hashchange', handleHashChange);

// wire nav buttons once DOM ready
function setupNavigation() {
    document.getElementById('btn-home').addEventListener('click', () => navigateTo('home'));
    document.getElementById('btn-check').addEventListener('click', () => navigateTo('check'));
    document.getElementById('btn-game').addEventListener('click', () => navigateTo('game'));
}

// --- end routing support -----------------------------------------------------

// simple permutation generator (returns array of strings)
function permute(str) {
    if (str.length <= 1) return [str];
    const results = new Set();
    for (let i = 0; i < str.length; i++) {
        const first = str[i];
        const rest = str.slice(0, i) + str.slice(i + 1);
        for (const perm of permute(rest)) {
            results.add(first + perm);
        }
    }
    return Array.from(results);
}

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

    // kolejne odwiedziny w jednej sesji: najpierw sprawdzamy sessionStorage,
    // w którym zachowujemy obiekt zwrócony przez IndexedDB. To jest szybkie
    // (synchronczne) i eliminuje nawet otwieranie bazy.
    const cached = sessionStorage.getItem('wordData');
    if (cached) {
        statusEl.textContent = 'Lista słów pobrana z pamięci sesyjnej.';
        try {
            return JSON.parse(cached);
        } catch (e) {
            // parser mógł się nie udać przy dużych danych – w razie czego wyczyść
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
        // zapisz do sessionStorage żeby kolejne ładowanie w ramach tej samej
        // karty było natychmiastowe
        try {
            sessionStorage.setItem('wordData', JSON.stringify(data));
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
    
    // organize words by length for faster lookup with long inputs
    const byLength = {};
    const set = new Set();
    for (const w of words) {
        set.add(w);
        if (!byLength[w.length]) byLength[w.length] = [];
        byLength[w.length].push(w);
    }

    // store both set and length index in IndexedDB
    const tx2 = db.transaction('words', 'readwrite');
    tx2.objectStore('words').put({set, byLength}, 'data');
    statusEl.textContent = 'Lista słów pobrana i zapisana w pamięci podręcznej.';
    return {set, byLength};
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
        statusEl.textContent = 'Czyszczenie pamięci podręcznej...';
        // delete indexeddb database
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

// search progress & cancellation
let currentSearchVersion = 0;
const searchProgress = document.getElementById('searchProgress');

function factorial(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

// Polish characters for wildcard expansion
const POLISH_CHARS = ['a', 'ą', 'b', 'c', 'ć', 'd', 'e', 'ę', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'ł', 'm', 'n', 'ń', 'o', 'ó', 'p', 'q', 'r', 's', 'ś', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ź', 'ż'];

function estimateTotal(letters) {
    // account for duplicate letters in regular chars
    const wildcardCount = (letters.match(/\?/g) || []).length;
    const regularChars = letters.replace(/\?/g, '');
    
    const counts = {};
    for (const c of regularChars) counts[c] = (counts[c] || 0) + 1;
    let total = factorial(regularChars.length);
    for (const k in counts) {
        total /= factorial(counts[k]);
    }
    
    // Multiply by 32^wildcardCount for each possible replacement of ?
    total *= Math.pow(32, wildcardCount);
    
    return total;
}

// check if word can be formed from available letters (with wildcard support)
function canFormWord(word, letters) {
    const wildcardCount = (letters.match(/\?/g) || []).length;
    const regularChars = letters.replace(/\?/g, '');
    
    const need = {};
    for (const c of word) need[c] = (need[c] || 0) + 1;

    const available = {};
    for (const c of regularChars) available[c] = (available[c] || 0) + 1;

    let usedWildcards = 0;
    for (const c in need) {
        const have = available[c] || 0;
        if (have < need[c]) {
            usedWildcards += need[c] - have;
        }
    }
    
    return usedWildcards <= wildcardCount;
}

// generator for all combinations of ? replacements
function* generateWildcardCombinations(str) {
    const indices = [];
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '?') indices.push(i);
    }
    
    if (indices.length === 0) {
        yield str;
        return;
    }
    
    const numCombinations = Math.pow(32, indices.length);
    for (let combo = 0; combo < numCombinations; combo++) {
        const result = str.split('');
        let temp = combo;
        for (let i = indices.length - 1; i >= 0; i--) {
            result[indices[i]] = POLISH_CHARS[temp % 32];
            temp = Math.floor(temp / 32);
        }
        yield result.join('');
    }
}

// generator yielding unique permutations with wildcard support
function* permuteGeneratorWithWildcards(str) {
    if (!str.includes('?')) {
        yield* permuteGenerator(str);
        return;
    }
    
    for (const perm of permuteGenerator(str)) {
        yield* generateWildcardCombinations(perm);
    }
}

// generator yielding unique permutations
function* permuteGenerator(str) {
    if (str.length <= 1) {
        yield str;
        return;
    }
    const seen = new Set();
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (seen.has(ch)) continue;
        seen.add(ch);
        const rest = str.slice(0, i) + str.slice(i+1);
        for (const perm of permuteGenerator(rest)) {
            yield ch + perm;
        }
    }
}

async function performSearch(letters, wordData, version) {
    const total = estimateTotal(letters);
    let checked = 0;
    const results = new Set();

    searchProgress.style.display = 'block';
    searchProgress.value = 0;

    for (const p of permuteGeneratorWithWildcards(letters)) {
        if (version !== currentSearchVersion) {
            // canceled
            searchProgress.style.display = 'none';
            return null;
        }
        checked++;
        if (wordData.set.has(p)) results.add(p);

        if (checked % 1000 === 0) {
            const percent = Math.min(100, Math.floor((checked / total) * 100));
            searchProgress.value = percent;
            // yield to UI
            await new Promise(r => setTimeout(r, 0));
        }
    }

    searchProgress.style.display = 'none';
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

async function performSearchLong(letters, wordData, version) {
    const len = letters.length;
    searchProgress.style.display = 'block';
    searchProgress.value = 0;

    const candidates = wordData.byLength[len] || [];
    let checked = 0;
    const results = new Set();

    for (const word of candidates) {
        if (version !== currentSearchVersion) {
            searchProgress.style.display = 'none';
            return null;
        }
        checked++;
        if (canFormWord(word, letters)) {
            results.add(word);
        }

        if (checked % 100 === 0) {
            const percent = Math.min(100, Math.floor((checked / candidates.length) * 100));
            searchProgress.value = percent;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    searchProgress.style.display = 'none';
    return results;
}

input.addEventListener('input', async () => {
    const letters = input.value.trim().toLowerCase();
    currentSearchVersion++;
    const version = currentSearchVersion;

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

        if (letters.length > 8) {
            // for long inputs, check only words of same length
            matchesSet = await performSearchLong(letters, wordData, version);
        } else {
            // for short inputs, use permutation approach
            matchesSet = await performSearch(letters, wordData, version);
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
