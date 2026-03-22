class WordOfTheDay {
    constructor(options = {}) {
        this.filePath = options.filePath || 'data/wotd-most-points/definicje.txt';
        this.wordElementId = options.wordElementId || 'word-of-the-day-value';
        this.descriptionElementId = options.descriptionElementId || 'word-of-the-day-description';
        this.calendarDayElementId = options.calendarDayElementId || 'word-of-the-day-calendar-day';
        this.entries = [];
    }

    renderCalendarDay(date = new Date()) {
        const dayEl = document.getElementById(this.calendarDayElementId);
        if (!dayEl) {
            return;
        }

        const day = String(date.getDate()).padStart(2, '0');
        dayEl.textContent = day;
    }

    async loadRawDefinitions() {
        if (typeof loadRawFileWithIndexedDbCache === 'function') {
            return await loadRawFileWithIndexedDbCache(this.filePath, 'text');
        }

        const resp = await fetch(this.filePath, { cache: 'no-store' });
        if (!resp.ok) {
            throw new Error(`Unable to fetch WOTD definitions file: ${this.filePath}`);
        }
        return await resp.text();
    }

    parseEntryLine(line) {
        const trimmed = line.trim();
        if (!trimmed) {
            return null;
        }

        const delimiterMatch = /\s+[–-]\s+/.exec(trimmed);
        if (!delimiterMatch) {
            return null;
        }

        const delimiterIndex = delimiterMatch.index;
        const delimiterLength = delimiterMatch[0].length;
        const word = trimmed.slice(0, delimiterIndex).trim();
        const definition = trimmed.slice(delimiterIndex + delimiterLength).trim();

        if (!word || !definition) {
            return null;
        }

        return { word, definition };
    }

    parseEntries(rawText) {
        const rows = rawText.split(/\r?\n/);
        const parsed = [];

        for (const row of rows) {
            const entry = this.parseEntryLine(row);
            if (entry) {
                parsed.push(entry);
            }
        }

        return parsed;
    }

    createDailyWordRng() {
        if (typeof createRngController === 'function' && typeof randomControl !== 'undefined' && randomControl?.dailySeedBase) {
            return createRngController(`${randomControl.dailySeedBase}:word-of-the-day`);
        }

        if (typeof randomControl !== 'undefined' && randomControl?.wordRng?.int) {
            return randomControl.wordRng;
        }

        return {
            int(maxExclusive) {
                if (maxExclusive <= 0) {
                    return 0;
                }
                return Math.floor(Math.random() * maxExclusive);
            }
        };
    }

    pickRandomEntry() {
        if (!this.entries.length) {
            return null;
        }

        const rng = this.createDailyWordRng();
        const index = rng.int(this.entries.length);
        return this.entries[index] || null;
    }

    renderEntry(entry) {
        const wordEl = document.getElementById(this.wordElementId);
        const descriptionEl = document.getElementById(this.descriptionElementId);

        if (!wordEl || !descriptionEl || !entry) {
            return;
        }

        const word = entry.word.charAt(0).toUpperCase() + entry.word.slice(1).toLowerCase();
        wordEl.textContent = word;
        descriptionEl.textContent = `- ${entry.definition}`;
    }

    async loadAndRender() {
        this.renderCalendarDay();

        const rawText = await this.loadRawDefinitions();
        this.entries = this.parseEntries(rawText);

        if (!this.entries.length) {
            console.warn(`[WordOfTheDay] No entries loaded from ${this.filePath}`);
            return null;
        }

        const selectedEntry = this.pickRandomEntry();
        this.renderEntry(selectedEntry);
        return selectedEntry;
    }
}
