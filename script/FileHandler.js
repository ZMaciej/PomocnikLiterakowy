const FILE_CACHE_DB_NAME = 'PomocnikLiterakowyFileCache';
const FILE_CACHE_DB_VERSION = 1;
const FILE_CACHE_STORE_NAME = 'rawFiles';

let fileCacheDbPromise = null;

function logFileCacheEvent(filePath, message, details = null) {
    if (details) {
        console.log(`[FileCache] ${filePath}: ${message}`, details);
        return;
    }

    console.log(`[FileCache] ${filePath}: ${message}`);
}

function parseUpdateDateText(text) {
    const match = /^(\d{2}):(\d{2}) (\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
    if (!match) {
        return null;
    }

    const [, hours, minutes, day, month, year] = match;
    const parsedDate = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        0,
        0
    );

    const timestamp = parsedDate.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

function getDirectoryPath(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
        return '';
    }
    return normalizedPath.slice(0, lastSlashIndex);
}

function getUpdateDateFilePath(filePath) {
    const directoryPath = getDirectoryPath(filePath);
    return directoryPath ? `${directoryPath}/updateDate.txt` : 'updateDate.txt';
}

function openFileCacheDb() {
    if (!('indexedDB' in window)) {
        return Promise.resolve(null);
    }

    if (!fileCacheDbPromise) {
        fileCacheDbPromise = new Promise(resolve => {
            const request = indexedDB.open(FILE_CACHE_DB_NAME, FILE_CACHE_DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(FILE_CACHE_STORE_NAME)) {
                    db.createObjectStore(FILE_CACHE_STORE_NAME, { keyPath: 'path' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error('Failed to open IndexedDB file cache', request.error);
                resolve(null);
            };
        });
    }

    return fileCacheDbPromise;
}

async function clearIndexedDbFileCache() {
    const db = await openFileCacheDb();
    if (!db) {
        console.warn('[FileCache] IndexedDB is not available; nothing to clear');
        return false;
    }

    return new Promise(resolve => {
        const transaction = db.transaction(FILE_CACHE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(FILE_CACHE_STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('[FileCache] IndexedDB file cache cleared');
            resolve(true);
        };
        request.onerror = () => {
            console.error('[FileCache] Failed to clear IndexedDB file cache', request.error);
            resolve(false);
        };
    });
}

window.clearIndexedDbFileCache = clearIndexedDbFileCache;

async function readCachedFileRecord(filePath) {
    const db = await openFileCacheDb();
    if (!db) {
        return null;
    }

    return new Promise(resolve => {
        const transaction = db.transaction(FILE_CACHE_STORE_NAME, 'readonly');
        const store = transaction.objectStore(FILE_CACHE_STORE_NAME);
        const request = store.get(filePath);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => {
            console.error(`Failed to read ${filePath} from IndexedDB`, request.error);
            resolve(null);
        };
    });
}

async function writeCachedFileRecord(filePath, content, updateDateMeta, responseType) {
    const db = await openFileCacheDb();
    if (!db) {
        return;
    }

    const cacheContent = responseType === 'arrayBuffer' ? content.slice(0) : content;

    return new Promise(resolve => {
        const transaction = db.transaction(FILE_CACHE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(FILE_CACHE_STORE_NAME);
        const request = store.put({
            path: filePath,
            content: cacheContent,
            responseType,
            updateDateText: updateDateMeta.text,
            updateTimestamp: updateDateMeta.timestamp,
            savedAt: Date.now()
        });

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Failed to write ${filePath} to IndexedDB`, request.error);
            resolve();
        };
    });
}

async function loadUpdateDateMeta(filePath) {
    const updateDatePath = getUpdateDateFilePath(filePath);

    try {
        const resp = await fetch(updateDatePath, { cache: 'no-store' });
        if (!resp.ok) {
            return null;
        }

        const text = (await resp.text()).trim();
        const timestamp = parseUpdateDateText(text);
        if (timestamp === null) {
            console.warn(`[FileCache] Invalid update date format in ${updateDatePath}: ${text}`);
            return null;
        }

        return { text, timestamp };
    } catch (e) {
        console.warn(`[FileCache] Could not load ${updateDatePath}; bypassing IndexedDB cache`, e);
        return null;
    }
}

async function fetchRawFile(filePath, responseType) {
    const resp = await fetch(filePath, { cache: 'no-store' });
    if (!resp.ok) {
        throw new Error(`Unable to fetch file: ${filePath}`);
    }

    if (responseType === 'arrayBuffer') {
        return resp.arrayBuffer();
    }

    return resp.text();
}

async function loadRawFileWithIndexedDbCache(filePath, responseType) {
    const updateDateMeta = await loadUpdateDateMeta(filePath);

    if (!updateDateMeta) {
        logFileCacheEvent(filePath, 'loaded from network; updateDate.txt missing or invalid, cache skipped');
        return fetchRawFile(filePath, responseType);
    }

    const cachedRecord = await readCachedFileRecord(filePath);
    if (
        cachedRecord &&
        cachedRecord.responseType === responseType &&
        typeof cachedRecord.updateTimestamp === 'number' &&
        cachedRecord.updateTimestamp >= updateDateMeta.timestamp
    ) {
        logFileCacheEvent(filePath, 'loaded from IndexedDB', {
            cachedUpdateDate: cachedRecord.updateDateText,
            requestedUpdateDate: updateDateMeta.text
        });
        return responseType === 'arrayBuffer'
            ? cachedRecord.content.slice(0)
            : cachedRecord.content;
    }

    const freshContent = await fetchRawFile(filePath, responseType);
    await writeCachedFileRecord(filePath, freshContent, updateDateMeta, responseType);
    logFileCacheEvent(filePath, 'loaded from network and saved to IndexedDB', {
        previousCachedUpdateDate: cachedRecord?.updateDateText ?? null,
        requestedUpdateDate: updateDateMeta.text
    });
    return freshContent;
}

async function splitWordsWithUiYield(text) {
    const words = [];
    let start = 0;
    let processedLines = 0;

    while (start <= text.length) {
        let lineEnd = text.indexOf('\n', start);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        let line = text.slice(start, lineEnd);
        if (line.endsWith('\r')) {
            line = line.slice(0, -1);
        }

        if (line) {
            words.push(line);
        }

        if (lineEnd === text.length) {
            break;
        }

        start = lineEnd + 1;
        processedLines++;

        // Yield periodically so loading timer can repaint while parsing huge files.
        if (processedLines % 1000000 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return words;
}

async function loadWordsFile(path = 'data/sjp-full/slowa.txt') {
    console.log('loadWordSet starting');

    const text = await loadRawFileWithIndexedDbCache(path, 'text');

    // sanity check
    if (!text || !text.trim()) {
        console.error('Fetched file text is empty');
        throw new Error('Word list file appears empty');
    }

    const words = await splitWordsWithUiYield(text);
    console.log('loaded', words.length, 'words');
    return words;
}

function convertWordSetToProcessedData(words) {
    // build a dictionary mapping sorted letter sequences to word lists

    const wordsArray = new Array();
    const anagramMap = {};

    for (let i = 0; i < words.length; i++) {
        w = words[i];
        wordsArray.push(w);
        const key = w.split('').sort().join('');
        (anagramMap[key] ??= []).push(i);
    }

    const lengthKeys = {};
    let indexOfKeyInMap = 0;
    for (const key of Object.keys(anagramMap)) {
        const len = key.length;
        if (!lengthKeys[len]) lengthKeys[len] = [];
        lengthKeys[len].push(indexOfKeyInMap);
        indexOfKeyInMap++;
    }
    return {wordsArray, anagramMap, lengthKeys};
}

async function saveProcessedDataToLocalStorage(processedData) {
    try {
        const anagramMap = processedData.anagramMap;
        await saveAnagramMapAsBinary(anagramMap, 'anagram_map.bin')
        const lengthKeys = processedData.lengthKeys;
        saveToFile('lengthKeys.json', JSON.stringify(lengthKeys));
    } catch (e) {
        console.error('Error processing and saving word data', e);
    }
}

async function loadFromJsonFile(fileName) {
    try {
        const rawJson = await loadRawFileWithIndexedDbCache(fileName, 'text');
        const data = JSON.parse(rawJson);
        const returnObject = Object.assign(Object.create(null), data);
        console.log(`Loaded data from ${fileName}`);
        return returnObject;
    } catch (e) {
        console.error(`Error loading JSON file ${fileName}`, e);
        return null;
    }
}

function getAnagramsForWord(anagramMap, anagramMapKey) {
    return anagramMap[anagramMapKey] || [];
}

async function commonPartWithSjp() {
    const topWords = await loadCsvFile('pl_top_words.csv');
    const words = await loadWordsFile();
    // convert topWords to a Set for faster lookup
    const topWordsSet = new Set(topWords.map(w => w.word));
    // filter the original word list to only include words that are in the topWordsSet
    const filteredWords = words.filter(w => topWordsSet.has(w));
    console.log('Filtered words count:', filteredWords.length);
    // save the filtered list to a new file
    saveToFile('filteredWords.txt', filteredWords.join('\n'));
}

function saveToFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 100);
    console.log(`File download started: ${filename}`);
}

async function loadCsvFile(fileName) {
    const resp = await fetch(fileName);
    if (!resp.ok) {
        throw new Error(`Unable to fetch CSV file: ${fileName}`);
    }
    const text = await resp.text();
    const rows = text.split(/\r?\n/).filter(Boolean);
    const data = rows.map(row => {
        const [word, count] = row.split(',');
        return { word, count: parseInt(count, 10) };
    });
    return data;
}

async function getProcessedWordFiles(filePath) {
    const words = await loadWordsFile(filePath);
    const processedDataStruct = convertWordSetToProcessedData(words);
    await saveProcessedDataToLocalStorage(processedDataStruct);
}