function hashStringToUint32(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createSeededRandom(seedString) {
    let state = hashStringToUint32(seedString);
    return function nextRandom() {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createRngController(seedString) {
    const random = createSeededRandom(seedString);
    return {
        seed: seedString,
        next() {
            return random();
        },
        int(maxExclusive) {
            if (maxExclusive <= 0) return 0;
            return Math.floor(random() * maxExclusive);
        }
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getTodaySeedString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getSessionSeedString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

const randomControl = {
    mode: 'normal',
    normalSeedBase: getSessionSeedString(),
    dailySeedBase: getTodaySeedString(),
    wordRng: null,
    mixRng: null
};

function configureRandomMode(mode) {
    const isDaily = mode === 'daily';
    const baseSeed = isDaily ? randomControl.dailySeedBase : randomControl.normalSeedBase;
    randomControl.mode = isDaily ? 'daily' : 'normal';
    randomControl.wordRng = createRngController(`${baseSeed}:word-sequence`);
    randomControl.mixRng = createRngController(`${baseSeed}:letter-mix`);
}

configureRandomMode('normal');