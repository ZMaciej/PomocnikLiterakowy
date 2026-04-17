class ConsoleStats {
    /**
     * @param {{ getWordSet: () => Promise }} deps
     */
    constructor({ getWordSet }) {
        this._getWordSet = getWordSet;
    }

    async getWordWithMostAnagrams() {
        const sjp = await this._getWordSet();
        let maxCount = 0;
        let maxKey = null;
        for (const [key, indices] of sjp.anagramMap.entries()) {
            const count = indices.length;
            if (count > maxCount) {
                maxCount = count;
                maxKey = key;
            }
        }
        const maxIndices = maxKey ? sjp.anagramMap.get(maxKey) || [] : [];
        const words = maxIndices.map(idx => sjp.wordsArray[idx]);
        return { key: maxKey, count: maxCount, words };
    }

    async getEveryWordWithEveryPointsLetter(letterCount) {
        const sjp = await this._getWordSet();
        const literakiData = new LiterakiData();
        const matchingWords = [];

        for (const indices of sjp.anagramMap.values()) {
            for (const idx of indices) {
                const w = sjp.wordsArray[idx];
                if (w.length !== letterCount) continue;
                let wordScore = 0;
                let onePointerPresent = false;
                let twoPointerPresent = false;
                let threePointerPresent = false;
                let fivePointerPresent = false;

                for (const ch of w) {
                    const points = literakiData.getLetterPoint(ch);
                    switch (points) {
                        case 1: onePointerPresent = true; break;
                        case 2: twoPointerPresent = true; break;
                        case 3: threePointerPresent = true; break;
                        case 5: fivePointerPresent = true; break;
                    }
                    wordScore += points;
                }

                const presentScore =
                    (onePointerPresent ? 1 : 0) +
                    (twoPointerPresent ? 1 : 0) +
                    (threePointerPresent ? 1 : 0) +
                    (fivePointerPresent ? 1 : 0);

                if (presentScore === 4) {
                    matchingWords.push({ word: w, score: wordScore });
                }
            }
        }

        matchingWords.sort((a, b) => b.score - a.score);
        return matchingWords;
    }

    async exportTop365SevenLetterWords() {
        const topWords = (await this.getEveryWordWithEveryPointsLetter(7)).slice(0, 365);
        const header = 'rank,word,score';
        const lines = topWords.map((entry, idx) => `${idx + 1},${entry.word},${entry.score}`);
        const content = [header, ...lines].join('\n');

        const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'top365_7liter_najwyzej_punktowane.csv';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
    }

    async getEveryWordPoints(letterCount) {
        const sjp = await this._getWordSet();
        const literakiData = new LiterakiData();
        const matchingWords = [];

        for (const indices of sjp.anagramMap.values()) {
            for (const idx of indices) {
                const w = sjp.wordsArray[idx];
                if (w.length !== letterCount) continue;
                let wordScore = 0;

                for (const ch of w) {
                    wordScore += literakiData.getLetterPoint(ch);
                }

                const usedCharsCountMap = {};
                for (const ch of w) {
                    usedCharsCountMap[ch] = (usedCharsCountMap[ch] || 0) + 1;
                }
                for (const ch in usedCharsCountMap) {
                    if (usedCharsCountMap[ch] > literakiData.getLetterCount(ch)) {
                        wordScore = -1;
                        break;
                    }
                }

                if (wordScore !== -1) {
                    matchingWords.push({ word: w, score: wordScore });
                }
            }
        }

        matchingWords.sort((a, b) => b.score - a.score);
        return matchingWords;
    }

    async getMostValuableWordOfLength(length) {
        const sjp = await this._getWordSet();
        const literakiData = new LiterakiData();
        let maxScore = 0;
        let bestWord = null;
        for (const indices of sjp.anagramMap.values()) {
            for (const idx of indices) {
                const w = sjp.wordsArray[idx];
                if (w.length !== length) continue;
                let wordScore = 0;
                for (const ch of w) {
                    wordScore += literakiData.getLetterPoint(ch);
                }
                if (wordScore > maxScore) {
                    maxScore = wordScore;
                    bestWord = w;
                }
            }
        }
        return { word: bestWord, score: maxScore };
    }

    async getWordsListWithXVowels(vowelCount, wordLength) {
        const sjp = await this._getWordSet();
        const literakiData = new LiterakiData();
        const matchingWords = [];
        for (const indices of sjp.anagramMap.values()) {
            for (const idx of indices) {
                const w = sjp.wordsArray[idx];
                if (w.length !== wordLength) continue;
                let count = 0;
                for (const ch of w) {
                    if (literakiData.isVowel.has(ch.toUpperCase())) count++;
                }
                if (count === vowelCount) {
                    matchingWords.push(w);
                }
            }
        }
        return matchingWords;
    }
}
