class GuessListView {
    addWord(word, kind) {
        const guessList = document.getElementById('guess-list');
        if (!guessList) return;

        // try to update existing entry from the current round instead of duplicating
        const items = Array.from(guessList.children);
        for (let i = items.length - 1; i >= 0; i--) {
            const node = items[i];
            if (node.classList && node.classList.contains('guess-separator')) break;
            const link = node.querySelector ? node.querySelector('a') : null;
            if (!link) continue;
            if (link.textContent !== word) continue;

            if (kind === 'correct') {
                link.classList.remove('guess-missed');
                link.classList.add('guess-correct');
            } else if (kind === 'missed') {
                if (!link.classList.contains('guess-correct')) {
                    link.classList.add('guess-missed');
                }
            }
            return;
        }

        const div = document.createElement('div');
        div.classList.add('guess-item');

        const a = document.createElement('a');
        a.textContent = word;
        a.href = `https://sjp.pl/${encodeURIComponent(word)}`;
        a.target = '_blank';
        a.rel = 'noopener';

        if (kind === 'correct') {
            a.classList.add('guess-correct');
        } else if (kind === 'missed') {
            a.classList.add('guess-missed');
        } else if (kind === 'wrong') {
            a.classList.add('guess-wrong');
        }

        div.appendChild(a);
        guessList.appendChild(div);
    }

    addSeparator() {
        const guessList = document.getElementById('guess-list');
        if (!guessList) return;
        const separator = document.createElement('div');
        separator.classList.add('guess-separator');
        separator.textContent = '---';
        guessList.appendChild(separator);
    }

    clear() {
        const guessList = document.getElementById('guess-list');
        while (guessList && guessList.firstChild) {
            guessList.removeChild(guessList.firstChild);
        }
        const correctSection = document.getElementById('correct-section');
        if (correctSection) correctSection.classList.add('hidden');
    }

    hasEntries() {
        const guessList = document.getElementById('guess-list');
        return guessList ? guessList.children.length > 0 : false;
    }
}
