function buildBinary(anagramMap) {
    const encoder = new TextEncoder();
    const entries = Object.entries(anagramMap);

    let totalSize = 4; // entry count

    for (const [key, arr] of entries) {
        const keyBytes = encoder.encode(key);
        totalSize += 2 + keyBytes.length; // key length + key
        const padding1 = (4 - ((totalSize) % 4)) % 4; // alignment before array length
        totalSize += padding1 + 2; // padding + array length
        const padding2 = (4 - ((totalSize) % 4)) % 4; // alignment before array data
        totalSize += padding2 + arr.length * 4;  // padding + array data
    }

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let offset = 0;

    view.setUint32(offset, entries.length, true);
    offset += 4;

    for (const [key, arr] of entries) {
        const keyBytes = encoder.encode(key);

        view.setUint16(offset, keyBytes.length, true);
        offset += 2;

        new Uint8Array(buffer, offset, keyBytes.length).set(keyBytes);
        offset += keyBytes.length;

        // Align offset to 4-byte boundary before array length
        const padding1 = (4 - (offset % 4)) % 4;
        offset += padding1;

        view.setUint16(offset, arr.length, true);
        offset += 2;

        // Align offset to 4-byte boundary for Uint32Array
        const padding2 = (4 - (offset % 4)) % 4;
        offset += padding2;

        new Uint32Array(buffer, offset, arr.length).set(arr);
        offset += arr.length * 4;
    }

    return buffer;
}
async function saveAnagramMap()
{
    const anagramMap = (await convertWordSetToProcessedData()).anagramMap;
    await saveAnagramMapAsBinary(anagramMap, 'anagram_map.bin');
}

async function saveAnagramMapAsBinary(anagramMap, fileName) {
    const buffer = buildBinary(anagramMap);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function parseBinary(buffer) {
    const view = new DataView(buffer);
    const decoder = new TextDecoder();

    let offset = 0;

    const entryCount = view.getUint32(offset, true);
    offset += 4;

    const map = new Map();

    for (let i = 0; i < entryCount; i++) {
        const keyLen = view.getUint16(offset, true);
        offset += 2;

        const keyBytes = new Uint8Array(buffer, offset, keyLen);
        const key = decoder.decode(keyBytes);
        offset += keyLen;

        // Align offset to 4-byte boundary before array length
        const padding1 = (4 - (offset % 4)) % 4;
        offset += padding1;

        const arrLen = view.getUint16(offset, true);
        offset += 2;

        // Align offset to 4-byte boundary for Uint32Array
        const padding2 = (4 - (offset % 4)) % 4;
        offset += padding2;

        const arr = new Uint32Array(buffer, offset, arrLen);
        offset += arrLen * 4;

        map.set(key, arr);
    }

    return map;
}

async function loadAnagramMapFromBinary(fileName) {
    const resp = await fetch(fileName);
    if (!resp.ok) {
        throw new Error(`Unable to fetch binary file: ${fileName}`);
    }
    const buffer = await resp.arrayBuffer();
    return parseBinary(buffer);
}

async function loadAnagramMap() {
    const anagramMap = await loadAnagramMapFromBinary('anagram_map.bin');
    console.log('Loaded anagram map from binary file');
    return anagramMap;
}

async function testAnagramMapLoading() {
    // binary method should be much faster than text parsing
    const timeStart = performance.now();
    const anagramMap = await loadAnagramMap();
    const timeEnd = performance.now();
    console.log(`Binary loading time: ${timeEnd - timeStart} ms`);
    // requesting the same key multiple times should be very fast since it's already in memory
    const timeStartRepeated = performance.now();
    let value;
    for (let i = 0; i < 100000; i++) {
      value = anagramMap.get('aabklorsą')[0];
    }
    console.log('Repeated access value:', value);
    const timeEndRepeated = performance.now();
    console.log(`Binary repeated access time: ${timeEndRepeated - timeStartRepeated} ms`);
    
    let keysArray = Array.from( anagramMap.keys() );

    // for comparison, also load from text-based JSON
    const timeStartJson = performance.now();
    const anagramMapFromText = await loadFromJsonFile('anagramMap.json');
    const timeEndJson = performance.now();
    console.log(`JSON loading time: ${timeEndJson - timeStartJson} ms`);
    // requesting the same key multiple times should be fast, but initial loading is much slower than binary
    const timeStartRepeatedJson = performance.now();
    let valueJson;
    for (let i = 0; i < 100000; i++) {
      valueJson = anagramMapFromText['aabklorsą'][0];
    }
    console.log('Repeated access value (JSON):', valueJson);
    const timeEndRepeatedJson = performance.now();
    console.log(`JSON repeated access time: ${timeEndRepeatedJson - timeStartRepeatedJson} ms`);
}