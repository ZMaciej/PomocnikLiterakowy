class SlownikJezykaPolskiego {
  constructor() {
    this.loaded = false;
    this.wordsArray = null;
    this.anagramArray = null;
    this.anagramMap = null;
    this.lengthKeys = null;
    this.polishChars = ['a', 'ą', 'b', 'c', 'ć', 'd', 'e', 'ę',
      'f', 'g', 'h', 'i', 'j', 'k', 'l', 'ł', 'm', 'n', 'ń', 'o', 'ó',
      'p', 'r', 's', 'ś', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ź', 'ż'];
  }
  // example path would be 'data/sjp-full'
  async load(path) {
    try {
      const [wordsArray, anagramMap, lengthKeys] = await Promise.all([
        downloadWordsFile(`${path}/slowa.txt`),
        loadAnagramMapFromBinary(`${path}/anagram_map.bin`),
        loadFromJsonFile(`${path}/lengthKeys.json`)
      ]);
      this.wordsArray = wordsArray;
      this.anagramMap = anagramMap;
      this.anagramArray = Array.from(anagramMap.keys());
      this.lengthKeys = lengthKeys;
      this.loaded = true;
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
}