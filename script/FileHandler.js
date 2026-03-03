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
    const anagramMap = {};
    let indexOfWord = 0;
    for (const w of words) {
        wordsArray.push(w);
        const key = w.split('').sort().join('');
        if (!anagramMap[key]) anagramMap[key] = [];
        anagramMap[key].push(indexOfWord);
        indexOfWord++;
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

async function saveProcessedDataToLocalStorage() {
    // This function downloads the processed word data as a JSON file to the user's computer.
    // request of downloading the file should be triggered manually from console to avoid blocking the main thread during normal gameplay
    try {
        const processedData = await convertWordSetToProcessedData();
        const jsonString = JSON.stringify(processedData);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'processedWordData.json';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
        console.log('Processed data download started');
    } catch (e) {
        console.error('Error processing and saving word data', e);
    }
}