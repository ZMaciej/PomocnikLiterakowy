async function loadProcessedDataFromLocalStorage() {
    try {
        const resp = await fetch('processedWordData.json');
        if (resp.ok) {
            const processedData = await resp.json();
            console.log('loaded preprocessed data from processedWordData.json');
            
            const set = new Set(processedData.wordsArray);
            const map = {};
            
            // Rebuild map from anagramMap
            for (const sortedLetters of Object.keys(processedData.anagramMap)) {
                const wordIndices = processedData.anagramMap[sortedLetters];
                const words = wordIndices.map(idx => processedData.wordsArray[idx]);
                map[sortedLetters] = words;
            }
            
            // Rebuild lengthKeys to point to sorted letter keys instead of indices
            const lengthKeysNew = {};
            for (const sortedLetters of Object.keys(processedData.anagramMap)) {
                const len = sortedLetters.length;
                if (!lengthKeysNew[len]) lengthKeysNew[len] = [];
                lengthKeysNew[len].push(sortedLetters);
            }
            
            return {set, map, lengthKeys: lengthKeysNew};
        }
    } catch (err) {
        console.log('Could not load processedWordData.json, falling back to slowa.txt', err);
    }
}

async function downloadWordsFile(path = 'data/sjp-full/slowa.txt') {
    console.log('loadWordSet starting');

    // fetch text file from same directory; make sure slowa.txt is available
    const resp = await fetch(path);
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
        const resp = await fetch(fileName);
        if (!resp.ok) {
            throw new Error(`Unable to fetch JSON file: ${fileName}`);
        }
        const data = await resp.json();
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
    const words = await downloadWordsFile();
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
    const words = await downloadWordsFile(filePath);
    const processedDataStruct = convertWordSetToProcessedData(words);
    await saveProcessedDataToLocalStorage(processedDataStruct);
}