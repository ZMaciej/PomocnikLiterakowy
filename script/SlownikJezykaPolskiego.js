class SlownikJezykaPolskiego {
  constructor() {
    this.loaded = false;
    this.wordsArray = null;
    this.anagramArray = null;
    this.anagramMap = null;
    this.lengthKeys = null;
    this.aggregatedStats = null;
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

      const statsBundleFolder = `${path}/aggregated_stats.v6.bundle`;
      const statsMetadataPath = `${statsBundleFolder}/aggregated_stats.v6.json`;
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

      const [wordsArray, anagramMap, lengthKeys, aggregatedStats] = await Promise.all([
        wordsPromise,
        anagramMapPromise,
        lengthKeysPromise,
        aggregatedStatsPromise
      ]);
      this.wordsArray = wordsArray;
      this.anagramMap = anagramMap;
      this.anagramArray = Array.from(anagramMap.keys());
      this.lengthKeys = lengthKeys;
      this.aggregatedStats = aggregatedStats;
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

}