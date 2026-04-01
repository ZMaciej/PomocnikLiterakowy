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

function sjpStatsSortNumericAscending(a, b) {
  return a - b;
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

    const buildState = {
      nextCollectionId: 1,
      collectionParts: [],
      currentCollectionPart: null,
      queryIndexParts: []
    };

    // Pre-scan: group word indices by word length so each length bucket can be
    // built and immediately finalized (freeing wordMatchSet memory) before moving
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
      const collectionPart = {
        length: wordLength,
        fileName: `aggregated_stats.substring_collections.len_${wordLength}.v1.bin`,
        collections: []
      };
      buildState.currentCollectionPart = collectionPart;

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
              exactEntry.wordMatchSet.push(wordIndex);
              seenExactInWord.add(value);
            }
          }

          const combinations = sjpStatsBuildUniqueLetterCombinations(letterFreqs, size);
          for (const value of combinations) {
            const lettersAnywhereEntry = this.ensureLettersAnywhereEntry(bucket.queryIndex.lettersAnywhere[size], value);
            lettersAnywhereEntry.wordMatchSet.push(wordIndex);
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

      // Finalize immediately after each length — deallocates wordMatchSets and
      // queryIndex Maps before building the next bucket.
      this.finalizeLengthBucket(bucket, {
        topN,
        maxScoredWords,
        prefixSuffixLengths,
        queryLengths,
        buildState,
        wordLength
      });

      if (collectionPart.collections.length > 0) {
        buildState.collectionParts.push(collectionPart);
      }
      buildState.currentCollectionPart = null;
    }

    this.attachAnagramStats(stats, maxAnagramGroups);
    const substringCollectionParts = buildState.collectionParts.map(part => ({
      length: part.length,
      fileName: part.fileName,
      collectionCount: part.collections.length,
      minCollectionId: part.collections[0].id,
      maxCollectionId: part.collections[part.collections.length - 1].id
    }));
    stats.substringCollections = {
      format: 'u32-index-v1',
      collectionCount: substringCollectionParts.reduce((sum, part) => sum + part.collectionCount, 0),
      parts: substringCollectionParts
    };

    stats.substringQueryIndexes = {
      format: 'query-lookup-v1',
      partCount: buildState.queryIndexParts.length,
      parts: buildState.queryIndexParts.map(part => ({
        length: part.length,
        querySize: part.querySize,
        mode: part.mode,
        fileName: part.fileName,
        entryCount: part.entryCount
      }))
    };

    return {
      metadata: stats,
      substringCollectionsBinaryParts: buildState.collectionParts.map(part => ({
        length: part.length,
        fileName: part.fileName,
        collectionCount: part.collections.length,
        buffer: SjpAggregatedStatsBuilder.encodeMatchCollectionsBinary(part.collections)
      })),
      substringQueryIndexBinaryParts: buildState.queryIndexParts.map(part => ({
        length: part.length,
        querySize: part.querySize,
        mode: part.mode,
        fileName: part.fileName,
        entryCount: part.entryCount,
        buffer: part.buffer
      }))
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
        sampleWords: [],
        wordMatchSet: [],
        matchCollectionId: null,
        shuffledKey: null,
        shuffledCollectionId: null
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
        sampleWords: [],
        wordMatchSet: [],
        matchCollectionId: null
      });
    }

    return map.get(key);
  }

  allocateCollectionId(buildState, indices) {
    if (!buildState.currentCollectionPart) {
      throw new Error('Missing active collection part while allocating substring collection id');
    }

    const id = buildState.nextCollectionId;
    buildState.nextCollectionId += 1;
    buildState.currentCollectionPart.collections.push({ id, indices });
    return id;
  }

  setCollectionFromWordSet(entry, buildState) {
    entry.wordMatchSet.sort(sjpStatsSortNumericAscending);
    const indices = Uint32Array.from(entry.wordMatchSet);
    entry.matchCollectionId = this.allocateCollectionId(buildState, indices);
    entry.wordCount = indices.length;
    delete entry.wordMatchSet;
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
      const canonicalCollections = new Map();

      for (const entry of bucket.queryIndex.lettersAnywhere[size].values()) {
        this.setCollectionFromWordSet(entry, options.buildState);
        entry.totalOccurrences = entry.wordCount;
        canonicalCollections.set(entry.value, entry.matchCollectionId);
      }

      for (const entry of bucket.queryIndex.exact[size].values()) {
        entry.shuffledKey = [...entry.value].sort(sjpStatsComparePl).join('');
        entry.shuffledCollectionId = canonicalCollections.get(entry.shuffledKey) || null;
        if (size === 1 && entry.shuffledCollectionId != null) {
          entry.matchCollectionId = entry.shuffledCollectionId;
          entry.wordCount = entry.wordMatchSet.length;
          delete entry.wordMatchSet;
        } else {
          this.setCollectionFromWordSet(entry, options.buildState);
        }
      }

      const exactEntries = this.normalizeQueryEntries(bucket.queryIndex.exact[size], totalWords, true);
      const lettersAnywhereEntries = this.normalizeQueryEntries(bucket.queryIndex.lettersAnywhere[size], totalWords, false);

      bucket.substringStats.exact[size] = {
        top: exactEntries.slice(0, topN)
      };
      bucket.substringStats.lettersAnywhere[size] = {
        top: lettersAnywhereEntries.slice(0, topN)
      };

      this.appendQueryIndexBinaryPart(exactEntries, {
        buildState: options.buildState,
        wordLength: options.wordLength,
        querySize: Number(size),
        mode: 'exact'
      });
      this.appendQueryIndexBinaryPart(lettersAnywhereEntries, {
        buildState: options.buildState,
        wordLength: options.wordLength,
        querySize: Number(size),
        mode: 'lettersAnywhere'
      });
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
        sampleWords: entry.sampleWords,
        matchCollectionId: entry.matchCollectionId,
        shuffledKey: withPositions ? entry.shuffledKey : undefined,
        shuffledCollectionId: withPositions ? entry.shuffledCollectionId : undefined
      }))
      .sort((a, b) => b.wordCount - a.wordCount || sjpStatsComparePl(a.value, b.value));
  }

  appendQueryIndexBinaryPart(entries, options) {
    const part = {
      length: options.wordLength,
      querySize: options.querySize,
      mode: options.mode,
      fileName: `aggregated_stats.substring_index.${options.mode}.len_${options.wordLength}.q_${options.querySize}.v1.bin`,
      entryCount: entries.length,
      buffer: SjpAggregatedStatsBuilder.encodeQueryIndexBinary(entries, options.mode === 'exact')
    };

    options.buildState.queryIndexParts.push(part);
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
          sampleWords: [],
          matchCollectionIds: [],
          shuffledKey: withPositions ? null : undefined,
          shuffledCollectionIds: withPositions ? [] : undefined
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

        if (Number.isInteger(entry.matchCollectionId) && !existing.matchCollectionIds.includes(entry.matchCollectionId)) {
          existing.matchCollectionIds.push(entry.matchCollectionId);
        }
        for (const collectionId of entry.matchCollectionIds || []) {
          if (Number.isInteger(collectionId) && !existing.matchCollectionIds.includes(collectionId)) {
            existing.matchCollectionIds.push(collectionId);
          }
        }

        if (withPositions) {
          if (!existing.shuffledKey && entry.shuffledKey) {
            existing.shuffledKey = entry.shuffledKey;
          }
          if (Number.isInteger(entry.shuffledCollectionId) && !existing.shuffledCollectionIds.includes(entry.shuffledCollectionId)) {
            existing.shuffledCollectionIds.push(entry.shuffledCollectionId);
          }
          for (const collectionId of entry.shuffledCollectionIds || []) {
            if (Number.isInteger(collectionId) && !existing.shuffledCollectionIds.includes(collectionId)) {
              existing.shuffledCollectionIds.push(collectionId);
            }
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
          sampleWords: entry.sampleWords,
          matchCollectionId: entry.matchCollectionIds[0] || null,
          matchCollectionIds: entry.matchCollectionIds,
          shuffledKey: withPositions ? entry.shuffledKey : undefined,
          shuffledCollectionId: withPositions ? (entry.shuffledCollectionIds[0] || null) : undefined,
          shuffledCollectionIds: withPositions ? entry.shuffledCollectionIds : undefined
        }))
        .sort((a, b) => b.wordCount - a.wordCount || sjpStatsComparePl(a.value, b.value));

      out[size] = {
        top: entries.slice(0, 10)
      };
    }
    return out;
  }

  static encodeQueryIndexBinary(entries, withExactFields) {
    const encoder = new TextEncoder();
    const normalized = (entries || []).map(entry => ({
      value: String(entry.value || ''),
      valueBytes: encoder.encode(String(entry.value || '')),
      matchCollectionId: Number.isInteger(entry.matchCollectionId) ? entry.matchCollectionId : 0,
      wordCount: Number(entry.wordCount || 0),
      totalOccurrences: Number(entry.totalOccurrences || 0),
      shuffledKeyBytes: withExactFields ? encoder.encode(String(entry.shuffledKey || '')) : new Uint8Array(0),
      shuffledCollectionId: withExactFields && Number.isInteger(entry.shuffledCollectionId) ? entry.shuffledCollectionId : 0
    })).sort((a, b) => sjpStatsComparePl(a.value, b.value));

    let totalBytes = 4;
    for (const entry of normalized) {
      totalBytes += 2 + entry.valueBytes.length + 4 + 4;
      if (withExactFields) {
        totalBytes += 4 + 2 + entry.shuffledKeyBytes.length + 4;
      }
    }

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;
    view.setUint32(offset, normalized.length, true);
    offset += 4;

    for (const entry of normalized) {
      view.setUint16(offset, entry.valueBytes.length, true);
      offset += 2;
      new Uint8Array(buffer, offset, entry.valueBytes.length).set(entry.valueBytes);
      offset += entry.valueBytes.length;

      view.setUint32(offset, entry.matchCollectionId, true);
      offset += 4;

      view.setUint32(offset, entry.wordCount, true);
      offset += 4;

      if (withExactFields) {
        view.setUint32(offset, entry.totalOccurrences, true);
        offset += 4;

        view.setUint16(offset, entry.shuffledKeyBytes.length, true);
        offset += 2;
        new Uint8Array(buffer, offset, entry.shuffledKeyBytes.length).set(entry.shuffledKeyBytes);
        offset += entry.shuffledKeyBytes.length;

        view.setUint32(offset, entry.shuffledCollectionId, true);
        offset += 4;
      }
    }

    return buffer;
  }

  static decodeQueryIndexBinary(buffer, withExactFields) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
      return new Map();
    }

    const decoder = new TextDecoder();
    const view = new DataView(buffer);
    let offset = 0;
    const count = view.getUint32(offset, true);
    offset += 4;

    const map = new Map();
    for (let i = 0; i < count; i++) {
      if (offset + 2 > buffer.byteLength) {
        throw new Error('Corrupted query index binary (value length overflow)');
      }

      const valueLen = view.getUint16(offset, true);
      offset += 2;
      if (offset + valueLen + 8 > buffer.byteLength) {
        throw new Error('Corrupted query index binary (value payload overflow)');
      }

      const value = decoder.decode(new Uint8Array(buffer, offset, valueLen));
      offset += valueLen;
      const matchCollectionId = view.getUint32(offset, true);
      offset += 4;
      const wordCount = view.getUint32(offset, true);
      offset += 4;

      if (!withExactFields) {
        map.set(value, {
          value,
          wordCount,
          matchCollectionId: matchCollectionId || null
        });
        continue;
      }

      if (offset + 4 + 2 > buffer.byteLength) {
        throw new Error('Corrupted query index binary (exact header overflow)');
      }

      const totalOccurrences = view.getUint32(offset, true);
      offset += 4;

      const shuffledKeyLen = view.getUint16(offset, true);
      offset += 2;
      if (offset + shuffledKeyLen + 4 > buffer.byteLength) {
        throw new Error('Corrupted query index binary (shuffled payload overflow)');
      }

      const shuffledKey = decoder.decode(new Uint8Array(buffer, offset, shuffledKeyLen));
      offset += shuffledKeyLen;

      const shuffledCollectionId = view.getUint32(offset, true);
      offset += 4;

      map.set(value, {
        value,
        wordCount,
        matchCollectionId: matchCollectionId || null,
        totalOccurrences,
        shuffledKey,
        shuffledCollectionId: shuffledCollectionId || null
      });
    }

    return map;
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

  static encodeMatchCollectionsBinary(collections) {
    const normalized = (collections || []).map(item => {
      const id = Number(item.id);
      const indices = item.indices instanceof Uint32Array
        ? item.indices
        : new Uint32Array(item.indices || []);

      return { id, indices };
    }).sort((a, b) => a.id - b.id);

    let totalBytes = 4;
    for (const item of normalized) {
      totalBytes += 8 + (item.indices.length * 4);
    }

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint32(offset, normalized.length, true);
    offset += 4;

    for (const item of normalized) {
      view.setUint32(offset, item.id, true);
      offset += 4;

      view.setUint32(offset, item.indices.length, true);
      offset += 4;

      const out = new Uint32Array(buffer, offset, item.indices.length);
      out.set(item.indices);
      offset += item.indices.length * 4;
    }

    return buffer;
  }

  static decodeMatchCollectionsBinary(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
      return new Map();
    }

    if (buffer.byteLength < 4) {
      return new Map();
    }

    const view = new DataView(buffer);
    let offset = 0;
    const collectionCount = view.getUint32(offset, true);
    offset += 4;

    const map = new Map();
    for (let i = 0; i < collectionCount; i++) {
      if (offset + 8 > buffer.byteLength) {
        throw new Error('Corrupted substring collections binary (header overflow)');
      }

      const id = view.getUint32(offset, true);
      offset += 4;

      const length = view.getUint32(offset, true);
      offset += 4;

      const byteLength = length * 4;
      if (offset + byteLength > buffer.byteLength) {
        throw new Error('Corrupted substring collections binary (payload overflow)');
      }

      const indices = new Uint32Array(length);
      indices.set(new Uint32Array(buffer, offset, length));
      map.set(id, indices);
      offset += byteLength;
    }

    return map;
  }
}

SjpAggregatedStatsBuilder.VERSION = 5;
window.SjpAggregatedStatsBuilder = SjpAggregatedStatsBuilder;
