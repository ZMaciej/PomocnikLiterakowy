class SjpStatsGenerator {
  constructor(sjp, literakiData = new LiterakiData()) {
    if (!sjp || !sjp.loaded || !sjp.wordsArray || !sjp.anagramMap) {
      throw new Error('SjpStatsGenerator requires a loaded SlownikJezykaPolskiego instance');
    }

    this.sjp = sjp;
    this.literakiData = literakiData;
  }

  getWords(wordLength = null) {
    if (wordLength == null) {
      return this.sjp.wordsArray;
    }
    return this.sjp.wordsArray.filter(word => word.length === wordLength);
  }

  generateLetterFrequencyStats(wordLength = null) {
    const words = this.getWords(wordLength);
    const totalWords = words.length;
    const letterCounts = new Map();
    const positionCounts = new Map();

    for (const word of words) {
      const chars = [...word.toUpperCase()];
      for (let idx = 0; idx < chars.length; idx++) {
        const ch = chars[idx];
        letterCounts.set(ch, (letterCounts.get(ch) || 0) + 1);

        if (!positionCounts.has(ch)) {
          positionCounts.set(ch, new Map());
        }

        const posMap = positionCounts.get(ch);
        const pos = idx + 1;
        posMap.set(pos, (posMap.get(pos) || 0) + 1);
      }
    }

    const letters = Array.from(letterCounts.entries())
      .map(([letter, count]) => {
        const posMap = positionCounts.get(letter) || new Map();
        const positions = Object.fromEntries(
          Array.from(posMap.entries()).sort((a, b) => a[0] - b[0])
        );

        return {
          letter,
          totalCount: count,
          positionCounts: positions
        };
      })
      .sort((a, b) => b.totalCount - a.totalCount || a.letter.localeCompare(b.letter, 'pl'));

    return {
      totalWords,
      wordLength,
      letters
    };
  }

  generatePrefixSuffixStats(options = {}) {
    const {
      prefixLength = 2,
      suffixLength = 2,
      topN = 20,
      wordLength = null
    } = options;

    const words = this.getWords(wordLength);
    const byLength = new Map();
    const allPrefixes = new Map();
    const allSuffixes = new Map();

    const addCount = (map, key) => {
      map.set(key, (map.get(key) || 0) + 1);
    };

    for (const word of words) {
      if (word.length < Math.max(prefixLength, suffixLength)) {
        continue;
      }

      const len = word.length;
      if (!byLength.has(len)) {
        byLength.set(len, {
          prefixes: new Map(),
          suffixes: new Map()
        });
      }

      const upper = word.toUpperCase();
      const prefix = upper.slice(0, prefixLength);
      const suffix = upper.slice(upper.length - suffixLength);

      addCount(allPrefixes, prefix);
      addCount(allSuffixes, suffix);
      addCount(byLength.get(len).prefixes, prefix);
      addCount(byLength.get(len).suffixes, suffix);
    }

    const topFromMap = map => Array.from(map.entries())
      .map(([chunk, count]) => ({ chunk, count }))
      .sort((a, b) => b.count - a.count || a.chunk.localeCompare(b.chunk, 'pl'))
      .slice(0, topN);

    const byLengthResult = Object.fromEntries(
      Array.from(byLength.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([len, stats]) => [
          len,
          {
            prefixes: topFromMap(stats.prefixes),
            suffixes: topFromMap(stats.suffixes)
          }
        ])
    );

    return {
      wordLength,
      prefixLength,
      suffixLength,
      topN,
      overall: {
        prefixes: topFromMap(allPrefixes),
        suffixes: topFromMap(allSuffixes)
      },
      byLength: byLengthResult
    };
  }

  generateVowelConsonantRatioStats(targetWordLength = null) {
    const words = this.getWords(targetWordLength);
    const byLength = new Map();

    const ensureLength = len => {
      if (!byLength.has(len)) {
        byLength.set(len, {
          ratios: [],
          wordsCount: 0,
          wordsWithoutVowels: 0
        });
      }
      return byLength.get(len);
    };

    for (const word of words) {
      const chars = [...word.toUpperCase()];
      const vowels = chars.filter(ch => this.literakiData.isVowel.has(ch)).length;
      const consonants = chars.length - vowels;

      const bucket = ensureLength(chars.length);
      bucket.wordsCount += 1;
      if (vowels === 0) {
        bucket.wordsWithoutVowels += 1;
      }

      // ratio = consonants / vowels; if vowels === 0, use consonants to avoid division by zero
      const ratio = vowels === 0 ? consonants : consonants / vowels;
      bucket.ratios.push(ratio);
    }

    const result = Object.fromEntries(
      Array.from(byLength.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([len, stats]) => {
          const sorted = [...stats.ratios].sort((a, b) => a - b);
          const average = sorted.length
            ? sorted.reduce((acc, val) => acc + val, 0) / sorted.length
            : 0;
          const median = this.#median(sorted);

          return [len, {
            wordsCount: stats.wordsCount,
            wordsWithoutVowels: stats.wordsWithoutVowels,
            averageConsonantsToVowelsRatio: average,
            medianConsonantsToVowelsRatio: median
          }];
        })
    );

    return {
      targetWordLength,
      byLength: result
    };
  }

  generateMaxAnagramStats(wordLength = null) {
    let maxCount = 0;
    let keys = [];

    for (const [key, indices] of this.sjp.anagramMap.entries()) {
      if (wordLength != null && key.length !== wordLength) {
        continue;
      }

      if (indices.length > maxCount) {
        maxCount = indices.length;
        keys = [key];
      } else if (indices.length === maxCount) {
        keys.push(key);
      }
    }

    const groups = keys.map(key => {
      const indices = this.sjp.anagramMap.get(key) || [];
      const words = Array.from(indices, idx => this.sjp.wordsArray[idx])
        .filter(word => typeof word === 'string')
        .sort((a, b) => a.localeCompare(b, 'pl'));
      return {
        key,
        count: words.length,
        words
      };
    });

    return {
      wordLength,
      maxAnagramCount: maxCount,
      groups
    };
  }

  generateFrequentLetterCombinationsStats(wordLength, combinationSizes = [2, 3, 4], topN = 20) {
    if (!Number.isInteger(wordLength) || wordLength <= 0) {
      throw new Error('wordLength must be a positive integer');
    }

    const words = this.getWords(wordLength);
    const results = {};

    for (const size of combinationSizes) {
      if (!Number.isInteger(size) || size <= 0) {
        continue;
      }

      const counts = new Map();
      for (const word of words) {
        const letters = [...word.toUpperCase()].sort((a, b) => a.localeCompare(b, 'pl'));
        if (letters.length < size) {
          continue;
        }

        // Deduplicate per-word so one word contributes at most 1 count for a given combo key.
        const combinations = this.#buildCombinations(letters, size);
        const comboKeysInWord = new Set(combinations.map(combo => combo.join('')));
        for (const key of comboKeysInWord) {
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }

      results[size] = Array.from(counts.entries())
        .map(([combination, count]) => ({ combination, count }))
        .sort((a, b) => b.count - a.count || a.combination.localeCompare(b.combination, 'pl'))
        .slice(0, topN);
    }

    return {
      wordLength,
      topN,
      byCombinationSize: results
    };
  }

  generateTopScoredWordsByLengthStats(options = {}) {
    const {
      minLength = 1,
      maxLength = Infinity,
      topN = 10,
      respectLetterCounts = true
    } = options;

    const byLength = new Map();

    for (const word of this.sjp.wordsArray) {
      const len = word.length;
      if (len < minLength || len > maxLength) {
        continue;
      }

      const score = this.#calculateWordScore(word);
      if (score < 0) {
        continue;
      }

      if (respectLetterCounts && !this.#isWordBuildableFromBag(word)) {
        continue;
      }

      if (!byLength.has(len)) {
        byLength.set(len, []);
      }

      byLength.get(len).push({
        word,
        score
      });
    }

    const normalized = Object.fromEntries(
      Array.from(byLength.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([len, entries]) => [
          len,
          entries
            .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word, 'pl'))
            .slice(0, topN)
        ])
    );

    return {
      minLength,
      maxLength,
      topN,
      respectLetterCounts,
      byLength: normalized
    };
  }

  generateRegexCapturingGroupStartStats(wordLength, regex) {
    if (!Number.isInteger(wordLength) || wordLength <= 0) {
      throw new Error('wordLength must be a positive integer');
    }
    if (!(regex instanceof RegExp)) {
      throw new Error('regex must be a RegExp instance');
    }

    const firstGroupStartCounts = new Array(wordLength).fill(0);
    let scannedWordsCount = 0;
    let matchingWordsCount = 0;
    const matchingWordIndices = [];

    const scanRegex = this.#createGlobalRegexWithIndices(regex);

    for (let wordIndex = 0; wordIndex < this.sjp.wordsArray.length; wordIndex++) {
      const word = this.sjp.wordsArray[wordIndex];
      if (typeof word !== 'string' || word.length !== wordLength) {
        continue;
      }
      scannedWordsCount += 1;

      scanRegex.lastIndex = 0;
      let matchedWord = false;
      let match = null;

      while ((match = scanRegex.exec(word)) !== null) {
        matchedWord = true;

        const groupStart = this.#resolveFirstGroupStartIndex(match);
        if (Number.isInteger(groupStart) && groupStart >= 0 && groupStart < wordLength) {
          firstGroupStartCounts[groupStart] += 1;
        }

        // Protect from infinite loops for zero-length matches in /g mode.
        if (match[0] === '') {
          scanRegex.lastIndex += 1;
        }
      }

      if (matchedWord) {
        matchingWordsCount += 1;
        matchingWordIndices.push(wordIndex);
      }
    }

    return {
      wordLength,
      scannedWordsCount,
      matchingWordsCount,
      matchingWordIndices,
      firstCapturingGroupStartCounts: firstGroupStartCounts
    };
  }

  generateSelectedStatistics(options = {}) {
    const {
      lettersWordLength = null,
      prefixesWordLength = null,
      ratioWordLength = null,
      maxAnagramsWordLength = null,
      combinationWordLength = 7,
      combinationSizes = [2, 3, 4],
      combinationTopN = 20,
      prefixesTopN = 20,
      topScoredTopN = 10
    } = options;

    return {
      letterFrequency: this.generateLetterFrequencyStats(lettersWordLength),
      prefixSuffix: this.generatePrefixSuffixStats({
        wordLength: prefixesWordLength,
        topN: prefixesTopN
      }),
      vowelConsonantRatio: this.generateVowelConsonantRatioStats(ratioWordLength),
      maxAnagrams: this.generateMaxAnagramStats(maxAnagramsWordLength),
      letterCombinations: this.generateFrequentLetterCombinationsStats(
        combinationWordLength,
        combinationSizes,
        combinationTopN
      ),
      topScoredByLength: this.generateTopScoredWordsByLengthStats({
        topN: topScoredTopN,
        respectLetterCounts: true
      })
    };
  }

  #calculateWordScore(word) {
    let total = 0;
    for (const ch of word) {
      total += this.literakiData.getLetterPoint(ch);
    }
    return total;
  }

  #isWordBuildableFromBag(word) {
    const used = Object.create(null);
    for (const ch of word.toUpperCase()) {
      used[ch] = (used[ch] || 0) + 1;
    }

    for (const ch of Object.keys(used)) {
      if (used[ch] > this.literakiData.getLetterCount(ch)) {
        return false;
      }
    }

    return true;
  }

  #median(sortedValues) {
    if (!sortedValues.length) {
      return 0;
    }

    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2 === 1) {
      return sortedValues[middle];
    }

    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  #createGlobalRegexWithIndices(regex) {
    const flagsSet = new Set(regex.flags.split(''));
    flagsSet.add('g');
    flagsSet.add('d');
    return new RegExp(regex.source, Array.from(flagsSet).join(''));
  }

  #resolveFirstGroupStartIndex(match) {
    if (Array.isArray(match.indices) && Array.isArray(match.indices[1])) {
      return match.indices[1][0];
    }

    // Fallback for runtimes without support for RegExp match indices (/d).
    if (typeof match.index !== 'number' || typeof match[1] !== 'string') {
      return null;
    }

    const fullMatch = typeof match[0] === 'string' ? match[0] : '';
    const groupValue = match[1];
    const relativeStart = fullMatch.indexOf(groupValue);
    if (relativeStart < 0) {
      return null;
    }

    return match.index + relativeStart;
  }

  #buildCombinations(values, size) {
    const out = [];
    const path = [];

    const walk = start => {
      if (path.length === size) {
        out.push([...path]);
        return;
      }

      for (let i = start; i < values.length; i++) {
        path.push(values[i]);
        walk(i + 1);
        path.pop();
      }
    };

    walk(0);
    return out;
  }
}

window.SjpStatsGenerator = SjpStatsGenerator;
