// Polish characters for wildcard expansion
const POLISH_CHARS = ['a', 'ą', 'b', 'c', 'ć', 'd', 'e', 'ę', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'ł', 'm', 'n', 'ń', 'o', 'ó', 'p', 'r', 's', 'ś', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ź', 'ż'];

class AnagramChecker {
    /**
     * @param {{ getWordSet: () => Promise }} deps
     */
    constructor({ getWordSet }) {
        this._getWordSet = getWordSet;
    }

    setup() {
        const input = document.getElementById('input-text');
        const output = document.getElementById('output');
        const outputWordMatch = document.getElementById('output-word-match');
        if (!input || !output) return;

        input.addEventListener('input', async () => {
            const letters = input.value.trim().toLowerCase();

            if (!letters) {
                output.textContent = '';
                if (outputWordMatch) outputWordMatch.textContent = '';
                return;
            }

            const wildcardCount = (letters.match(/\?/g) || []).length;
            if (wildcardCount > 2) {
                output.textContent = '⚠';
                if (outputWordMatch) outputWordMatch.textContent = 'maks. 2 blanki';
                return;
            }

            try {
                const sjp = await this._getWordSet();
                let matchesSet;

                if (wildcardCount === 0) {
                    const key = letters.split('').sort().join('');
                    const arr = sjp.getAnagrams(key);
                    matchesSet = new Set(arr);
                } else {
                    const keys = this._getWildcardKeys(letters);
                    matchesSet = new Set();
                    for (const key of keys) {
                        const arr = sjp.getAnagrams(key);
                        if (arr && arr.length) {
                            for (const w of arr) matchesSet.add(w);
                        }
                    }
                }

                if (matchesSet === null) return;
                output.textContent = String(matchesSet.size);

                if (outputWordMatch) {
                    if (wildcardCount === 0 && matchesSet.has(letters)) {
                        outputWordMatch.textContent = '✓ to słowo';
                        outputWordMatch.style.color = '#2a9d2a';
                    } else if (wildcardCount === 0) {
                        outputWordMatch.textContent = matchesSet.size > 0 ? '✗ nie jest słowem' : '';
                        outputWordMatch.style.color = '#c0392b';
                    } else {
                        outputWordMatch.textContent = '';
                        outputWordMatch.style.color = '';
                    }
                }
            } catch (err) {
                console.error(err);
                output.textContent = '!';
                if (outputWordMatch) outputWordMatch.textContent = 'błąd';
            }
        });
    }

    _getWildcardKeys(str) {
        const indices = [];
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '?') indices.push(i);
        }
        const results = new Set();
        const arr = str.split('');

        function helper(pos) {
            if (pos === indices.length) {
                results.add(arr.slice().sort().join(''));
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
            results.add(str.split('').sort().join(''));
        } else {
            helper(0);
        }
        return results;
    }

    _pluralForm(count) {
        if (count === 1) return 'słowo';
        const mod10 = count % 10;
        const mod100 = count % 100;
        if ((mod100 >= 12 && mod100 <= 14) || mod10 === 0 || (mod10 >= 5 && mod10 <= 9)) {
            return 'słów';
        }
        return 'słowa';
    }
}
