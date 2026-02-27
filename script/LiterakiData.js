class LiterakiData {
  constructor() {
    this.lettersCount = {
      'A': 9,
      'Ą': 1,
      'B': 2,
      'C': 3,
      'Ć': 1,
      'D': 3,
      'E': 7,
      'Ę': 1,
      'F': 1,
      'G': 2,
      'H': 2,
      'I': 8,
      'J': 2,
      'K': 3,
      'L': 3,
      'Ł': 2,
      'M': 3,
      'N': 5,
      'Ń': 1,
      'O': 6,
      'Ó': 1,
      'P': 3,
      'R': 4,
      'S': 4,
      'Ś': 1,
      'T': 3,
      'U': 2,
      'W': 4,
      'Y': 4,
      'Z': 5,
      'Ź': 1,
      'Ż': 1,
      '?': 2
    }
    this.letterPoints = {
      '?': 0,
      'A': 1, 'E': 1, 'I': 1, 'N': 1, 'O': 1, 'R': 1, 'S': 1, 'W': 1, 'Z': 1,
      'C': 2, 'D': 2, 'K': 2, 'L': 2, 'M': 2, 'P': 2, 'T': 2, 'Y': 2,
      'B': 3, 'G': 3, 'H': 3, 'J': 3, 'Ł': 3, 'U': 3,
      'Ą': 5, 'Ć': 5, 'Ę': 5, 'F': 5, 'Ń': 5, 'Ó': 5, 'Ś': 5, 'Ź': 5, 'Ż': 5
    }
  }

  getLetterPoint(letter) {
    letter = letter.toUpperCase();
    return this.letterPoints[letter] || -1;
  }
  getLetterCount(letter) {
    letter = letter.toUpperCase();
    return this.lettersCount[letter] || 0;
  }
}
