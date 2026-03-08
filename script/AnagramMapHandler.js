function buildBinary(anagramMap) {
    const encoder = new TextEncoder();
    const entries = Object.entries(anagramMap);

    let totalSize = 4; // entry count

    for (const [key, arr] of entries) {
        const keyBytes = encoder.encode(key);
        totalSize += 2 + keyBytes.length; // key length + key
        totalSize += 2 + arr.length * 4;  // array length + numbers
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

        view.setUint16(offset, arr.length, true);
        offset += 2;

        new Uint32Array(buffer, offset, arr.length).set(arr);
        offset += arr.length * 4;
    }

    return buffer;
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

    const map = Object.create(null);

    for (let i = 0; i < entryCount; i++) {
        const keyLen = view.getUint16(offset, true);
        offset += 2;

        const keyBytes = new Uint8Array(buffer, offset, keyLen);
        const key = decoder.decode(keyBytes);
        offset += keyLen;

        const arrLen = view.getUint16(offset, true);
        offset += 2;

        const arr = new Uint32Array(buffer, offset, arrLen);
        offset += arrLen * 4;

        map[key] = arr;
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