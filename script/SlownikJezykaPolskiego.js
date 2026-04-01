class SlownikJezykaPolskiego {
  constructor() {
    this.loaded = false;
    this.wordsArray = null;
    this.anagramArray = null;
    this.anagramMap = null;
    this.lengthKeys = null;
    this.aggregatedStats = null;
    this.substringMatchCollections = new Map();
    this.substringQueryIndexMaps = new Map();
    this.onProgress = null;
    this.polishChars = ['a', 'ą', 'b', 'c', 'ć', 'd', 'e', 'ę',
      'f', 'g', 'h', 'i', 'j', 'k', 'l', 'ł', 'm', 'n', 'ń', 'o', 'ó',
      'p', 'r', 's', 'ś', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ź', 'ż'];
  }

  progressCallback(percentOrPayload, message) {
    const percent = typeof percentOrPayload === 'number'
      ? percentOrPayload
      : percentOrPayload?.percent;
    const statusMessage = typeof percentOrPayload === 'object'
      ? percentOrPayload.message
      : message;

    if (typeof this.onProgress === 'function') {
      this.onProgress({ percent, message: statusMessage, dictionary: this });
      return;
    }

    if (typeof updateLoadingProgress === 'function' && Number.isFinite(percent)) {
      updateLoadingProgress(percent);
    }

    if (typeof updateStatus === 'function' && statusMessage) {
      updateStatus(statusMessage);
    }
  }

  // example path would be 'data/sjp-full'
  async load(path, onProgress = null) {
    try {
      let comments = ['Pobieranie listy słów...',
        'Wczytywanie mapy anagramów...',
        'Liczenie statystyk słownika...',
        'Finalizowanie słownika...',
        'Słownik gotowy!',
        'Słownik gotowy!'];
      let progressValues = [10, 35, 55, 75, 90, 100];
      let currentCommentIndex = 0;

      this.onProgress = typeof onProgress === 'function' ? onProgress : null;
      this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);

      const wordsPromise = loadWordsFile(`${path}/slowa.txt`).then(wordsArray => {
        currentCommentIndex++;
        this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);
        return wordsArray;
      });

      const anagramMapPromise = loadAnagramMapFromBinary(`${path}/anagram_map.bin`, wordsPromise).then(anagramMap => {
        currentCommentIndex++;
        this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);
        return anagramMap;
      });

      const lengthKeysPromise = loadLengthKeysFromJson(`${path}/lengthKeys.json`, anagramMapPromise).then(lengthKeys => {
        currentCommentIndex++;
        this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);
        return lengthKeys;
      });

      const statsBundleFolder = `${path}/aggregated_stats.v5.bundle`;
      const statsMetadataPath = `${statsBundleFolder}/aggregated_stats.v5.json`;
      let derivedArtifactsPromise = null;
      const getDerivedArtifacts = async () => {
        if (derivedArtifactsPromise) {
          return derivedArtifactsPromise;
        }

        derivedArtifactsPromise = (async () => {
          const [wordsArray, anagramMap, lengthKeys] = await Promise.all([
            wordsPromise,
            anagramMapPromise,
            lengthKeysPromise
          ]);

          const statsDictionary = {
            loaded: true,
            wordsArray,
            anagramMap,
            lengthKeys,
            polishChars: this.polishChars
          };
          const Builder = window.SjpAggregatedStatsBuilder;
          if (typeof Builder !== 'function') {
            throw new Error('SjpAggregatedStatsBuilder is unavailable');
          }

          const builder = new Builder(statsDictionary);
          return builder.buildDerivedArtifacts();
        })();

        return derivedArtifactsPromise;
      };

      const aggregatedStatsPromise = loadDerivedJsonFromCacheOrGenerate(statsMetadataPath, async () => {
        const artifacts = await getDerivedArtifacts();
        return artifacts.metadata;
      }, {
        preferNetworkWhenGenerate: true,
        cacheWithoutUpdateDate: true
      });

      const decodedCollectionsPromise = aggregatedStatsPromise.then(async aggregatedStats => {
        const parts = Array.isArray(aggregatedStats?.substringCollections?.parts)
          ? aggregatedStats.substringCollections.parts
          : [];

        if (!parts.length) {
          return new Map();
        }

        const partBuffers = await Promise.all(parts.map(async part => {
          const partPath = `${statsBundleFolder}/${part.fileName}`;
          return loadRawFileWithIndexedDbCacheOrGenerate(partPath, 'arrayBuffer', async () => {
            const artifacts = await getDerivedArtifacts();
            const generatedPart = (artifacts.substringCollectionsBinaryParts || []).find(item => item.fileName === part.fileName);
            if (!generatedPart) {
              throw new Error(`Missing generated substring collections part: ${part.fileName}`);
            }

            return generatedPart.buffer;
          }, {
            preferNetworkWhenGenerate: true,
            cacheWithoutUpdateDate: true
          });
        }));

        const Builder = window.SjpAggregatedStatsBuilder;
        if (typeof Builder !== 'function') {
          throw new Error('SjpAggregatedStatsBuilder is unavailable');
        }

        const collections = new Map();
        for (const buffer of partBuffers) {
          const decodedPart = Builder.decodeMatchCollectionsBinary(buffer);
          for (const [collectionId, indices] of decodedPart.entries()) {
            collections.set(collectionId, indices);
          }
        }

        return collections;
      }).then(collections => {
        currentCommentIndex++;
        this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);
        return collections;
      });

      const decodedQueryIndexPromise = aggregatedStatsPromise.then(async aggregatedStats => {
        const parts = Array.isArray(aggregatedStats?.substringQueryIndexes?.parts)
          ? aggregatedStats.substringQueryIndexes.parts
          : [];

        if (!parts.length) {
          return new Map();
        }

        const Builder = window.SjpAggregatedStatsBuilder;
        if (typeof Builder !== 'function') {
          throw new Error('SjpAggregatedStatsBuilder is unavailable');
        }

        const decoded = new Map();
        await Promise.all(parts.map(async part => {
          const partPath = `${statsBundleFolder}/${part.fileName}`;
          const buffer = await loadRawFileWithIndexedDbCacheOrGenerate(partPath, 'arrayBuffer', async () => {
            const artifacts = await getDerivedArtifacts();
            const generatedPart = (artifacts.substringQueryIndexBinaryParts || []).find(item => item.fileName === part.fileName);
            if (!generatedPart) {
              throw new Error(`Missing generated substring query index part: ${part.fileName}`);
            }

            return generatedPart.buffer;
          }, {
            preferNetworkWhenGenerate: true,
            cacheWithoutUpdateDate: true
          });

          const key = this.getSubstringQueryIndexMapKey(part.mode, Number(part.length), Number(part.querySize));
          decoded.set(key, Builder.decodeQueryIndexBinary(buffer, part.mode === 'exact'));
        }));

        return decoded;
      });

      const [wordsArray, anagramMap, lengthKeys, aggregatedStats, substringMatchCollections, substringQueryIndexMaps] = await Promise.all([
        wordsPromise,
        anagramMapPromise,
        lengthKeysPromise,
        aggregatedStatsPromise,
        decodedCollectionsPromise,
        decodedQueryIndexPromise
      ]);
      this.wordsArray = wordsArray;
      this.anagramMap = anagramMap;
      this.anagramArray = Array.from(anagramMap.keys());
      this.lengthKeys = lengthKeys;
      this.aggregatedStats = aggregatedStats;
      this.substringMatchCollections = substringMatchCollections;
      this.substringQueryIndexMaps = substringQueryIndexMaps;
      this.loaded = true;
      currentCommentIndex++;
      this.progressCallback(progressValues[currentCommentIndex], comments[currentCommentIndex]);
      console.log('SlownikJezykaPolskiego loaded successfully');
    }
    catch (err) {
      console.error('Error loading SlownikJezykaPolskiego:', err);
      throw err;
    }
  }

  getAnagrams(word) {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }
    const sorted = word.split('').sort().join('');
    const indices = this.anagramMap.get(sorted);
    if (!indices) return [];
    let anagrams = [];
    for (const idx of indices) {
      anagrams.push(this.wordsArray[idx]);
    }
    return anagrams;
  }

  anagramExists(word) {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }
    const sorted = word.split('').sort().join('');
    return !!this.anagramMap.get(sorted);
  }

  getCountByLength(length) {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }
    const keyIndices = this.lengthKeys[length];
    if (!keyIndices) return 0;
    let count = 0;
    for (const keyIndex of keyIndices) {
      const key = this.anagramArray[keyIndex];
      const indices = this.anagramMap.get(key);
      if (indices) {
        count += indices.length;
      }
    }
    return count;
  }

  getSortedAnagramCountsByLength(wordLength) {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }
    const keys = this.lengthKeys[wordLength];
    if (!keys) return 0;
    return keys.length;
  }

  getAnagramListFromIndex(wordLength, keyIndex) {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }
    const keys = this.lengthKeys[wordLength];
    if (!keys || keyIndex >= keys.length) return [];
    const key = this.anagramArray[keys[keyIndex]];
    const indices = this.anagramMap.get(key);
    if (!indices) return [];
    let anagrams = [];
    for (const idx of indices) {
      anagrams.push(this.wordsArray[idx]);
    }
    return anagrams;
  }

  getAggregatedStats() {
    if (!this.loaded) {
      throw new Error('SlownikJezykaPolskiego not loaded yet');
    }

    return this.aggregatedStats;
  }

  getAggregatedStatsForLength(wordLength) {
    const stats = this.getAggregatedStats();
    return stats?.byLength?.[wordLength] || null;
  }

  getCombinedAggregatedStats(lengths) {
    const stats = this.getAggregatedStats();
    const Builder = window.SjpAggregatedStatsBuilder;
    if (!stats || typeof Builder !== 'function') {
      return null;
    }

    return Builder.createCombinedView(stats, lengths);
  }

  getMatchIndicesForCollection(collectionId) {
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return [];
    }

    const indices = this.substringMatchCollections.get(collectionId);
    if (!indices) {
      return [];
    }

    return Array.from(indices);
  }

  getSubstringQueryIndexMapKey(mode, wordLength, querySize) {
    return `${mode}|${wordLength}|${querySize}`;
  }

  getSubstringQueryIndexEntry(mode, wordLength, querySize, lookupValue) {
    const key = this.getSubstringQueryIndexMapKey(mode, wordLength, querySize);
    const indexMap = this.substringQueryIndexMaps.get(key);
    if (!indexMap) {
      return null;
    }

    return indexMap.get(lookupValue) || null;
  }

  getQueryStats(query, options = {}) {
    const normalized = String(query || '').trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    const exactMode = options.exactMode !== false;
    const lengths = Array.isArray(options.lengths)
      ? options.lengths.map(item => Number(item)).filter(item => Number.isInteger(item) && item > 0)
      : Object.keys(this.aggregatedStats?.byLength || {}).map(item => Number(item));

    if (!lengths.length) {
      return null;
    }

    const lookupValue = exactMode
      ? normalized
      : [...normalized].sort(sjpStatsComparePl).join('');

    const mode = exactMode ? 'exact' : 'lettersAnywhere';
    const foundEntries = [];
    for (const length of lengths) {
      const entry = this.getSubstringQueryIndexEntry(mode, length, normalized.length, lookupValue);
      if (entry) {
        foundEntries.push(entry);
      }
    }

    if (!foundEntries.length) {
      return null;
    }

    const mergedEntry = {
      value: lookupValue,
      wordCount: 0,
      totalOccurrences: 0,
      percentageOfWords: 0,
      matchCollectionIds: [],
      matchCollectionId: null,
      shuffledKey: null,
      shuffledCollectionIds: [],
      shuffledCollectionId: null,
      sampleWords: []
    };

    const totalSelectedWords = lengths.reduce((sum, length) => {
      return sum + (this.aggregatedStats?.byLength?.[length]?.wordCount || 0);
    }, 0);

    for (const entry of foundEntries) {
      mergedEntry.wordCount += Number(entry.wordCount || 0);
      mergedEntry.totalOccurrences += Number(entry.totalOccurrences || 0);
      if (Number.isInteger(entry.matchCollectionId) && !mergedEntry.matchCollectionIds.includes(entry.matchCollectionId)) {
        mergedEntry.matchCollectionIds.push(entry.matchCollectionId);
      }
      if (exactMode) {
        if (!mergedEntry.shuffledKey && entry.shuffledKey) {
          mergedEntry.shuffledKey = entry.shuffledKey;
        }
        if (Number.isInteger(entry.shuffledCollectionId) && !mergedEntry.shuffledCollectionIds.includes(entry.shuffledCollectionId)) {
          mergedEntry.shuffledCollectionIds.push(entry.shuffledCollectionId);
        }
      }
    }

    mergedEntry.percentageOfWords = totalSelectedWords > 0 ? mergedEntry.wordCount / totalSelectedWords : 0;
    mergedEntry.matchCollectionId = mergedEntry.matchCollectionIds[0] || null;
    mergedEntry.shuffledCollectionId = mergedEntry.shuffledCollectionIds[0] || null;

    const collectionIds = mergedEntry.matchCollectionIds.length
      ? mergedEntry.matchCollectionIds
      : (Number.isInteger(mergedEntry.matchCollectionId) ? [mergedEntry.matchCollectionId] : []);
    const merged = new Set();
    for (const collectionId of collectionIds) {
      const indices = this.substringMatchCollections.get(collectionId);
      if (!indices) {
        continue;
      }

      for (let i = 0; i < indices.length; i++) {
        merged.add(indices[i]);
      }
    }

    return {
      query: normalized,
      exactMode,
      lookupValue,
      entry: mergedEntry,
      matchedIndices: Array.from(merged.values()).sort((a, b) => a - b)
    };
  }
}