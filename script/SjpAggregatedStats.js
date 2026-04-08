function sjpStatsComparePl(a, b) {
  return String(a).localeCompare(String(b), 'pl');
}

function sjpStatsMedian(sortedValues) {
  if (!sortedValues.length) {
    return 0;
  }

  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle];
  }

  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function sjpStatsBuildUniqueLetterCombinations(letterFreqs, size) {
  // Generates all unique multiset combinations of exactly `size` letters from
  // letterFreqs (sorted [[letter, countInWord], ...]).
  // Each letter can appear at most `count` times (its frequency in the word).
  // Zero duplicates — no need for deduplication with a Set afterwards.
  const out = [];
  const path = [];

  function walk(freqIndex, remaining) {
    if (remaining === 0) {
      out.push(path.join(''));
      return;
    }

    if (freqIndex >= letterFreqs.length) {
      return;
    }

    const [letter, count] = letterFreqs[freqIndex];
    const maxTake = Math.min(count, remaining);

    // take 0 of this letter (skip): recurse without pushing
    walk(freqIndex + 1, remaining);

    // take 1..maxTake of this letter: push cumulatively, then pop all at end
    for (let t = 1; t <= maxTake; t++) {
      path.push(letter);
      walk(freqIndex + 1, remaining - t);
    }
    for (let t = 1; t <= maxTake; t++) {
      path.pop();
    }
  }

  walk(0, size);
  return out;
}

class SjpAggregatedStatsBuilder {
  constructor(sjp, literakiData = new LiterakiData()) {
    if (!sjp || !sjp.loaded || !sjp.wordsArray || !sjp.anagramMap) {
      throw new Error('SjpAggregatedStatsBuilder requires a loaded SlownikJezykaPolskiego instance');
    }

    this.sjp = sjp;
    this.literakiData = literakiData;
  }

  build(options = {}) {
    return this.buildDerivedArtifacts(options).metadata;
  }

  buildDerivedArtifacts(options = {}) {
    const prefixSuffixLengths = options.prefixSuffixLengths || [2, 3, 4];
    const queryLengths = options.queryLengths || [1, 2, 3, 4];
    const maxIndexedWordLength = Number.isInteger(options.maxIndexedWordLength) ? options.maxIndexedWordLength : 10;
    const topN = Number.isInteger(options.topN) ? options.topN : 10;
    const sampleWordLimit = Number.isInteger(options.sampleWordLimit) ? options.sampleWordLimit : 5;
    const maxScoredWords = Number.isInteger(options.maxScoredWords) ? options.maxScoredWords : 10;
    const maxAnagramGroups = Number.isInteger(options.maxAnagramGroups) ? options.maxAnagramGroups : 10;

    const stats = {
      version: SjpAggregatedStatsBuilder.VERSION,
      generatedAt: new Date().toISOString(),
      totalWords: this.sjp.wordsArray.length,
      maxIndexedWordLength,
      wordCountByLength: Object.create(null),
      byLength: Object.create(null)
    };

    // Pre-scan: group word indices by word length so each length bucket can be
    // built and immediately finalized before moving
    // to the next length. This keeps peak memory proportional to one bucket at a
    // time instead of the sum of all buckets simultaneously.
    const wordsByLength = new Map();
    for (let wordIndex = 0; wordIndex < this.sjp.wordsArray.length; wordIndex++) {
      const rawWord = this.sjp.wordsArray[wordIndex];
      if (typeof rawWord !== 'string' || !rawWord) {
        continue;
      }

      const wordLength = rawWord.length;
      if (wordLength > maxIndexedWordLength) {
        continue;
      }

      stats.wordCountByLength[wordLength] = (stats.wordCountByLength[wordLength] || 0) + 1;
      let group = wordsByLength.get(wordLength);
      if (!group) {
        group = [];
        wordsByLength.set(wordLength, group);
      }
      group.push(wordIndex);
    }

    for (const [wordLength, wordIndices] of wordsByLength) {
      const bucket = this.ensureLengthBucket(stats.byLength, wordLength, queryLengths, prefixSuffixLengths);

      for (const wordIndex of wordIndices) {
        const rawWord = this.sjp.wordsArray[wordIndex];
        const word = rawWord.toUpperCase();
        const letters = [...word];

        bucket.wordCount += 1;

        const wordLetterCounts = Object.create(null);
        let score = 0;
        let vowels = 0;

        for (let index = 0; index < letters.length; index++) {
          const letter = letters[index];
          wordLetterCounts[letter] = (wordLetterCounts[letter] || 0) + 1;
          score += this.literakiData.getLetterPoint(letter);
          if (this.literakiData.isVowel.has(letter)) {
            vowels += 1;
          }

          bucket.totalLetters += 1;
          bucket.letterCounts.set(letter, (bucket.letterCounts.get(letter) || 0) + 1);
          const positions = this.ensureArrayValue(bucket.letterPositionCounts, letter, wordLength);
          positions[index] += 1;
        }

        for (const letter of Object.keys(wordLetterCounts)) {
          bucket.letterWordPresenceCounts.set(letter, (bucket.letterWordPresenceCounts.get(letter) || 0) + 1);
        }

        for (const size of prefixSuffixLengths) {
          if (wordLength < size) {
            continue;
          }

          const prefix = word.slice(0, size);
          const suffix = word.slice(word.length - size);
          bucket.prefixCounts[size].set(prefix, (bucket.prefixCounts[size].get(prefix) || 0) + 1);
          bucket.suffixCounts[size].set(suffix, (bucket.suffixCounts[size].get(suffix) || 0) + 1);
        }

        // letterFreqs computed once per word, shared across all query sizes
        const letterFreqs = Object.entries(wordLetterCounts).sort(([a], [b]) => sjpStatsComparePl(a, b));

        for (const size of queryLengths) {
          if (wordLength < size) {
            continue;
          }

          const seenExactInWord = new Set();
          for (let start = 0; start <= word.length - size; start++) {
            const value = word.slice(start, start + size);
            const exactEntry = this.ensureExactEntry(bucket.queryIndex.exact[size], value, wordLength - size + 1);
            exactEntry.totalOccurrences += 1;
            exactEntry.startPositions[start] += 1;
            this.appendSampleWord(exactEntry.sampleWords, rawWord, sampleWordLimit);

            if (!seenExactInWord.has(value)) {
              exactEntry.wordCount += 1;
              seenExactInWord.add(value);
            }
          }

          const combinations = sjpStatsBuildUniqueLetterCombinations(letterFreqs, size);
          for (const value of combinations) {
            const lettersAnywhereEntry = this.ensureLettersAnywhereEntry(bucket.queryIndex.lettersAnywhere[size], value);
            lettersAnywhereEntry.wordCount += 1;
            lettersAnywhereEntry.totalOccurrences += 1;
            this.appendSampleWord(lettersAnywhereEntry.sampleWords, rawWord, sampleWordLimit);
          }
        }

        const consonants = wordLength - vowels;
        bucket.vowelRatios.push(vowels === 0 ? consonants : consonants / vowels);
        if (vowels === 0) {
          bucket.wordsWithoutVowels += 1;
        }

        if (this.isWordBuildableFromBag(wordLetterCounts)) {
          bucket.scoredWords.push({
            word: rawWord,
            score,
            scorePerLetter: wordLength > 0 ? score / wordLength : 0
          });
        }
      }

      // Finalize immediately after each length before building the next bucket.
      this.finalizeLengthBucket(bucket, {
        topN,
        maxScoredWords,
        prefixSuffixLengths,
        queryLengths
      });
    }

    this.attachAnagramStats(stats, maxAnagramGroups);

    return {
      metadata: stats
    };
  }

  ensureLengthBucket(byLength, wordLength, queryLengths, prefixSuffixLengths) {
    if (byLength[wordLength]) {
      return byLength[wordLength];
    }

    const prefixCounts = Object.create(null);
    const suffixCounts = Object.create(null);
    for (const size of prefixSuffixLengths) {
      prefixCounts[size] = new Map();
      suffixCounts[size] = new Map();
    }

    const queryIndex = {
      exact: Object.create(null),
      lettersAnywhere: Object.create(null)
    };
    for (const size of queryLengths) {
      queryIndex.exact[size] = new Map();
      queryIndex.lettersAnywhere[size] = new Map();
    }

    byLength[wordLength] = {
      wordCount: 0,
      totalLetters: 0,
      letterCounts: new Map(),
      letterWordPresenceCounts: new Map(),
      letterPositionCounts: new Map(),
      prefixCounts,
      suffixCounts,
      queryIndex,
      scoredWords: [],
      vowelRatios: [],
      wordsWithoutVowels: 0,
      topAnagramGroups: []
    };

    return byLength[wordLength];
  }

  ensureArrayValue(map, key, size) {
    if (!map.has(key)) {
      map.set(key, new Array(size).fill(0));
    }

    return map.get(key);
  }

  ensureExactEntry(map, key, positionsCount) {
    if (!map.has(key)) {
      map.set(key, {
        value: key,
        wordCount: 0,
        totalOccurrences: 0,
        startPositions: new Array(positionsCount).fill(0),
        sampleWords: []
      });
    }

    return map.get(key);
  }

  ensureLettersAnywhereEntry(map, key) {
    if (!map.has(key)) {
      map.set(key, {
        value: key,
        wordCount: 0,
        totalOccurrences: 0,
        sampleWords: []
      });
    }

    return map.get(key);
  }

  appendSampleWord(sampleWords, word, sampleWordLimit) {
    if (sampleWords.length >= sampleWordLimit || sampleWords.includes(word)) {
      return;
    }

    sampleWords.push(word);
  }

  finalizeLengthBucket(bucket, options) {
    const totalWords = bucket.wordCount;
    const totalLetters = bucket.totalLetters;
    const topN = options.topN;

    bucket.shareOfAllWords = this.sjp.wordsArray.length > 0 ? totalWords / this.sjp.wordsArray.length : 0;
    bucket.letterFrequency = {
      totalWords,
      totalLetters,
      letters: Array.from(bucket.letterCounts.entries())
        .map(([letter, count]) => ({
          letter,
          totalCount: count,
          wordsContaining: bucket.letterWordPresenceCounts.get(letter) || 0,
          percentageOfLetters: totalLetters > 0 ? count / totalLetters : 0,
          percentageOfWordsContaining: totalWords > 0 ? (bucket.letterWordPresenceCounts.get(letter) || 0) / totalWords : 0,
          positionCounts: bucket.letterPositionCounts.get(letter) || []
        }))
        .sort((a, b) => b.totalCount - a.totalCount || sjpStatsComparePl(a.letter, b.letter))
    };

    bucket.prefixSuffix = {
      prefixes: Object.create(null),
      suffixes: Object.create(null)
    };
    for (const size of options.prefixSuffixLengths) {
      bucket.prefixSuffix.prefixes[size] = this.normalizeCountMap(bucket.prefixCounts[size], totalWords, 'chunk', topN);
      bucket.prefixSuffix.suffixes[size] = this.normalizeCountMap(bucket.suffixCounts[size], totalWords, 'chunk', topN);
    }

    bucket.substringStats = {
      exact: Object.create(null),
      lettersAnywhere: Object.create(null)
    };

    for (const size of options.queryLengths) {
      const exactEntries = this.normalizeQueryEntries(bucket.queryIndex.exact[size], totalWords, true);
      const lettersAnywhereEntries = this.normalizeQueryEntries(bucket.queryIndex.lettersAnywhere[size], totalWords, false);

      bucket.substringStats.exact[size] = {
        top: exactEntries.slice(0, topN)
      };
      bucket.substringStats.lettersAnywhere[size] = {
        top: lettersAnywhereEntries.slice(0, topN)
      };
    }

    bucket.vowelConsonantRatio = {
      wordsCount: totalWords,
      wordsWithoutVowels: bucket.wordsWithoutVowels,
      averageConsonantsToVowelsRatio: bucket.vowelRatios.length
        ? bucket.vowelRatios.reduce((acc, value) => acc + value, 0) / bucket.vowelRatios.length
        : 0,
      medianConsonantsToVowelsRatio: sjpStatsMedian([...bucket.vowelRatios].sort((a, b) => a - b))
    };

    bucket.topScoredWords = bucket.scoredWords
      .sort((a, b) => b.score - a.score || sjpStatsComparePl(a.word, b.word))
      .slice(0, options.maxScoredWords);

    delete bucket.letterCounts;
    delete bucket.letterWordPresenceCounts;
    delete bucket.letterPositionCounts;
    delete bucket.prefixCounts;
    delete bucket.suffixCounts;
    delete bucket.queryIndex;
    delete bucket.scoredWords;
    delete bucket.vowelRatios;
    delete bucket.totalLetters;
    delete bucket.wordsWithoutVowels;
  }

  normalizeCountMap(map, totalWords, keyName, topN) {
    return Array.from(map.entries())
      .map(([value, count]) => ({
        [keyName]: value,
        count,
        percentageOfWords: totalWords > 0 ? count / totalWords : 0
      }))
      .sort((a, b) => b.count - a.count || sjpStatsComparePl(a[keyName], b[keyName]))
      .slice(0, topN);
  }

  normalizeQueryEntries(map, totalWords, withPositions) {
    return Array.from(map.values())
      .map(entry => ({
        value: entry.value,
        wordCount: entry.wordCount,
        totalOccurrences: entry.totalOccurrences,
        percentageOfWords: totalWords > 0 ? entry.wordCount / totalWords : 0,
        startPositions: withPositions ? entry.startPositions : undefined,
        sampleWords: entry.sampleWords
      }))
      .sort((a, b) => b.wordCount - a.wordCount || sjpStatsComparePl(a.value, b.value));
  }

  attachAnagramStats(stats, maxAnagramGroups) {
    const grouped = Object.create(null);

    for (const [key, indices] of this.sjp.anagramMap.entries()) {
      const length = key.length;
      if (!grouped[length]) {
        grouped[length] = [];
      }

      grouped[length].push({
        key,
        count: indices.length,
        words: Array.from(indices, idx => this.sjp.wordsArray[idx])
          .filter(word => typeof word === 'string')
          .sort(sjpStatsComparePl)
      });
    }

    for (const [length, groups] of Object.entries(grouped)) {
      const bucket = stats.byLength[length];
      if (!bucket) {
        continue;
      }

      bucket.topAnagramGroups = groups
        .sort((a, b) => b.count - a.count || sjpStatsComparePl(a.words[0], b.words[0]))
        .slice(0, maxAnagramGroups);
    }
  }

  isWordBuildableFromBag(wordLetterCounts) {
    for (const letter of Object.keys(wordLetterCounts)) {
      if (wordLetterCounts[letter] > this.literakiData.getLetterCount(letter)) {
        return false;
      }
    }

    return true;
  }

  static createCombinedView(stats, lengths) {
    if (!stats || !stats.byLength) {
      return null;
    }

    const numericLengths = Array.from(new Set((lengths || [])
      .map(length => Number(length))
      .filter(length => Number.isInteger(length) && length > 0)))
      .sort((a, b) => a - b);

    if (!numericLengths.length) {
      return null;
    }

    const combined = {
      lengths: numericLengths,
      wordCount: 0,
      shareOfAllWords: 0,
      wordCountByLength: Object.create(null),
      letterFrequency: {
        totalWords: 0,
        totalLetters: 0,
        letters: []
      },
      prefixSuffix: {
        prefixes: Object.create(null),
        suffixes: Object.create(null)
      },
      substringStats: {
        exact: Object.create(null),
        lettersAnywhere: Object.create(null)
      },
      vowelConsonantRatio: null,
      topScoredWords: [],
      topAnagramGroups: []
    };

    const letterMap = new Map();
    const prefixMaps = Object.create(null);
    const suffixMaps = Object.create(null);
    const exactMaps = Object.create(null);
    const lettersAnywhereMaps = Object.create(null);
    const topScored = [];
    const topAnagrams = [];
    let weightedAverageRatioNumerator = 0;
    const weightedMedians = [];
    let totalLetters = 0;
    let wordsWithoutVowels = 0;

    for (const length of numericLengths) {
      const bucket = stats.byLength[length];
      if (!bucket) {
        continue;
      }

      combined.wordCount += bucket.wordCount;
      combined.wordCountByLength[length] = bucket.wordCount;
      totalLetters += bucket.letterFrequency.totalLetters;
      wordsWithoutVowels += bucket.vowelConsonantRatio.wordsWithoutVowels;
      Array.prototype.push.apply(topScored, bucket.topScoredWords);
      Array.prototype.push.apply(topAnagrams, bucket.topAnagramGroups);
      weightedAverageRatioNumerator += bucket.vowelConsonantRatio.averageConsonantsToVowelsRatio * bucket.wordCount;
      weightedMedians.push({
        value: bucket.vowelConsonantRatio.medianConsonantsToVowelsRatio,
        weight: bucket.wordCount
      });

      for (const letterEntry of bucket.letterFrequency.letters) {
        const existing = letterMap.get(letterEntry.letter) || {
          letter: letterEntry.letter,
          totalCount: 0,
          wordsContaining: 0,
          positionCounts: []
        };

        existing.totalCount += letterEntry.totalCount;
        existing.wordsContaining += letterEntry.wordsContaining;
        letterEntry.positionCounts.forEach((count, index) => {
          existing.positionCounts[index] = (existing.positionCounts[index] || 0) + count;
        });
        letterMap.set(letterEntry.letter, existing);
      }

      SjpAggregatedStatsBuilder.mergeRankedGroups(prefixMaps, bucket.prefixSuffix.prefixes, 'chunk');
      SjpAggregatedStatsBuilder.mergeRankedGroups(suffixMaps, bucket.prefixSuffix.suffixes, 'chunk');
      SjpAggregatedStatsBuilder.mergeQueryIndexGroups(exactMaps, bucket.substringStats.exact, true);
      SjpAggregatedStatsBuilder.mergeQueryIndexGroups(lettersAnywhereMaps, bucket.substringStats.lettersAnywhere, false);
    }

    combined.shareOfAllWords = stats.totalWords > 0 ? combined.wordCount / stats.totalWords : 0;
    combined.letterFrequency.totalWords = combined.wordCount;
    combined.letterFrequency.totalLetters = totalLetters;
    combined.letterFrequency.letters = Array.from(letterMap.values())
      .map(entry => ({
        letter: entry.letter,
        totalCount: entry.totalCount,
        wordsContaining: entry.wordsContaining,
        percentageOfLetters: totalLetters > 0 ? entry.totalCount / totalLetters : 0,
        percentageOfWordsContaining: combined.wordCount > 0 ? entry.wordsContaining / combined.wordCount : 0,
        positionCounts: entry.positionCounts
      }))
      .sort((a, b) => b.totalCount - a.totalCount || sjpStatsComparePl(a.letter, b.letter));

    combined.prefixSuffix.prefixes = SjpAggregatedStatsBuilder.finalizeCombinedRankedGroups(prefixMaps, combined.wordCount, 'chunk');
    combined.prefixSuffix.suffixes = SjpAggregatedStatsBuilder.finalizeCombinedRankedGroups(suffixMaps, combined.wordCount, 'chunk');
    combined.substringStats.exact = SjpAggregatedStatsBuilder.finalizeCombinedQueryIndex(exactMaps, combined.wordCount, true);
    combined.substringStats.lettersAnywhere = SjpAggregatedStatsBuilder.finalizeCombinedQueryIndex(lettersAnywhereMaps, combined.wordCount, false);
    combined.vowelConsonantRatio = {
      wordsCount: combined.wordCount,
      wordsWithoutVowels,
      averageConsonantsToVowelsRatio: combined.wordCount > 0
        ? weightedAverageRatioNumerator / combined.wordCount
        : 0,
      medianConsonantsToVowelsRatio: SjpAggregatedStatsBuilder.weightedMedian(weightedMedians)
    };
    combined.topScoredWords = topScored
      .sort((a, b) => b.score - a.score || sjpStatsComparePl(a.word, b.word))
      .slice(0, 10);
    combined.topAnagramGroups = topAnagrams
      .sort((a, b) => b.count - a.count || sjpStatsComparePl(a.words[0], b.words[0]))
      .slice(0, 10);

    return combined;
  }

  static mergeRankedGroups(target, source, keyName) {
    for (const [size, entries] of Object.entries(source || {})) {
      if (!target[size]) {
        target[size] = new Map();
      }

      for (const entry of entries || []) {
        const existing = target[size].get(entry[keyName]) || { [keyName]: entry[keyName], count: 0 };
        existing.count += entry.count;
        target[size].set(entry[keyName], existing);
      }
    }
  }

  static finalizeCombinedRankedGroups(target, totalWords, keyName) {
    const out = Object.create(null);
    for (const [size, entriesMap] of Object.entries(target)) {
      out[size] = Array.from(entriesMap.values())
        .map(entry => ({
          [keyName]: entry[keyName],
          count: entry.count,
          percentageOfWords: totalWords > 0 ? entry.count / totalWords : 0
        }))
        .sort((a, b) => b.count - a.count || sjpStatsComparePl(a[keyName], b[keyName]))
        .slice(0, 10);
    }
    return out;
  }

  static mergeQueryIndexGroups(target, source, withPositions) {
    for (const [size, section] of Object.entries(source || {})) {
      if (!target[size]) {
        target[size] = new Map();
      }

      for (const entry of (section.entries || section.top || [])) {
        const existing = target[size].get(entry.value) || {
          value: entry.value,
          wordCount: 0,
          totalOccurrences: 0,
          startPositions: withPositions ? [] : undefined,
          sampleWords: []
        };

        existing.wordCount += entry.wordCount;
        existing.totalOccurrences += entry.totalOccurrences || 0;
        if (withPositions && Array.isArray(entry.startPositions)) {
          entry.startPositions.forEach((count, index) => {
            existing.startPositions[index] = (existing.startPositions[index] || 0) + count;
          });
        }
        for (const sampleWord of entry.sampleWords || []) {
          if (!existing.sampleWords.includes(sampleWord) && existing.sampleWords.length < 5) {
            existing.sampleWords.push(sampleWord);
          }
        }

        target[size].set(entry.value, existing);
      }
    }
  }

  static finalizeCombinedQueryIndex(target, totalWords, withPositions) {
    const out = Object.create(null);
    for (const [size, entriesMap] of Object.entries(target)) {
      const entries = Array.from(entriesMap.values())
        .map(entry => ({
          value: entry.value,
          wordCount: entry.wordCount,
          totalOccurrences: entry.totalOccurrences,
          percentageOfWords: totalWords > 0 ? entry.wordCount / totalWords : 0,
          startPositions: withPositions ? entry.startPositions : undefined,
          sampleWords: entry.sampleWords
        }))
        .sort((a, b) => b.wordCount - a.wordCount || sjpStatsComparePl(a.value, b.value));

      out[size] = {
        top: entries.slice(0, 10)
      };
    }
    return out;
  }

  static weightedMedian(valuesWithWeight) {
    const normalized = (valuesWithWeight || [])
      .filter(item => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
      .sort((a, b) => a.value - b.value);

    if (!normalized.length) {
      return 0;
    }

    const totalWeight = normalized.reduce((sum, item) => sum + item.weight, 0);
    const midpoint = totalWeight / 2;
    let cumulative = 0;
    for (const item of normalized) {
      cumulative += item.weight;
      if (cumulative >= midpoint) {
        return item.value;
      }
    }

    return normalized[normalized.length - 1].value;
  }

}

SjpAggregatedStatsBuilder.VERSION = 6;
window.SjpAggregatedStatsBuilder = SjpAggregatedStatsBuilder;
