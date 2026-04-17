class TileDragController {
    /**
     * @param {{ getLetters: () => string, setLetters: (s: string) => void, onSwap: () => void }} deps
     */
    constructor({ getLetters, setLetters, onSwap }) {
        this._getLetters = getLetters;
        this._setLetters = setLetters;
        this._onSwap = onSwap;

        this.tileElements = [];
        this._draggingIndex = null;
        this._floatingEl = null;

        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
    }

    renderTiles() {
        const display = document.getElementById('letter-display');
        if (!display) return;
        const literakiData = new LiterakiData();
        const letters = this._getLetters();

        const needsFullRerender = this.tileElements.length !== letters.length || this.tileElements.length === 0;

        if (needsFullRerender) {
            this.tileElements.forEach(tile => {
                tile.removeEventListener('pointerdown', tile._pointerDownHandler);
            });
            while (display.firstChild) display.removeChild(display.firstChild);
            this.tileElements = [];

            letters.split('').forEach((ch, idx) => {
                const span = document.createElement('span');
                span.className = 'letter-tile';
                if (this._draggingIndex === idx) span.classList.add('dragging');
                span.textContent = ch.toUpperCase();
                this._applyPointClass(span, literakiData.getLetterPoint(ch));
                span.dataset.index = idx;
                const handler = (e) => this._tilePointerDown(e, span);
                span._pointerDownHandler = handler;
                span.addEventListener('pointerdown', handler);
                display.appendChild(span);
                this.tileElements.push(span);
            });
        } else {
            letters.split('').forEach((ch, idx) => {
                const tile = this.tileElements[idx];
                if (!tile) return;
                tile.textContent = ch.toUpperCase();
                tile.classList.remove('yellow-letter', 'green-letter', 'blue-letter', 'red-letter', 'dragging');
                this._applyPointClass(tile, literakiData.getLetterPoint(ch));
                if (this._draggingIndex === idx) tile.classList.add('dragging');
            });
        }
    }

    resetTiles() {
        this.tileElements = [];
        this._draggingIndex = null;
    }

    _applyPointClass(el, points) {
        switch (points) {
            case 1: el.classList.add('yellow-letter'); break;
            case 2: el.classList.add('green-letter'); break;
            case 3: el.classList.add('blue-letter'); break;
            case 5: el.classList.add('red-letter'); break;
        }
    }

    _getDocumentZoomFactor() {
        const zoomValue = window.getComputedStyle(document.documentElement).zoom;
        const parsed = Number.parseFloat(zoomValue);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }

    _swapLetters(i, j) {
        const arr = this._getLetters().split('');
        const [letter] = arr.splice(i, 1);
        arr.splice(j, 0, letter);
        this._setLetters(arr.join(''));
    }

    _tilePointerDown(e, tile) {
        document.body.style.userSelect = 'none';
        e.preventDefault();
        const idx = parseInt(tile.dataset.index, 10);
        this._draggingIndex = idx;

        this._floatingEl = document.createElement('span');
        this._floatingEl.className = 'letter-tile floating';
        this._floatingEl.textContent = tile.textContent;
        Array.from(tile.classList).forEach(cls => {
            if (cls !== 'letter-tile' && cls !== 'dragging') {
                this._floatingEl.classList.add(cls);
            }
        });
        document.body.appendChild(this._floatingEl);
        this._moveFloating(e);

        this.tileElements.forEach((t, i) => {
            t.classList.toggle('dragging', i === idx);
        });

        window.addEventListener('pointermove', this._onPointerMove, { passive: false });
        window.addEventListener('pointerup', this._onPointerUp, { passive: false });
        window.addEventListener('pointercancel', this._onPointerUp, { passive: false });
    }

    _moveFloating(e) {
        if (!this._floatingEl) return;
        const zoom = this._getDocumentZoomFactor();
        const x = (e.pageX / zoom) - this._floatingEl.offsetWidth / 2;
        const y = (e.pageY / zoom) - this._floatingEl.offsetHeight / 2;
        this._floatingEl.style.left = x + 'px';
        this._floatingEl.style.top = y + 'px';
    }

    _onPointerMove(e) {
        this._moveFloating(e);
        const elem = document.elementFromPoint(e.clientX, e.clientY);
        if (elem && elem.classList.contains('letter-tile') && !elem.classList.contains('floating')) {
            const dst = parseInt(elem.dataset.index, 10);
            if (dst !== this._draggingIndex) {
                this._swapLetters(this._draggingIndex, dst);
                this._rebuildTilesFromState(dst);
                this._draggingIndex = dst;
                this._onSwap();
            }
        }
    }

    _rebuildTilesFromState(dragIdx) {
        if (this.tileElements.length !== this._getLetters().length) return;
        const literakiData = new LiterakiData();
        this._getLetters().split('').forEach((ch, idx) => {
            const tile = this.tileElements[idx];
            if (!tile) return;
            tile.textContent = ch.toUpperCase();
            tile.dataset.index = idx;
            tile.classList.remove('yellow-letter', 'green-letter', 'blue-letter', 'red-letter');
            this._applyPointClass(tile, literakiData.getLetterPoint(ch));
            tile.classList.toggle('dragging', idx === dragIdx);
        });
    }

    _onPointerUp() {
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', this._onPointerMove, { passive: false });
        window.removeEventListener('pointerup', this._onPointerUp, { passive: false });
        window.removeEventListener('pointercancel', this._onPointerUp, { passive: false });

        if (this._floatingEl && this._floatingEl.parentNode) {
            this._floatingEl.parentNode.removeChild(this._floatingEl);
        }
        this._floatingEl = null;
        this.tileElements.forEach(tile => tile.classList.remove('dragging'));
        this._draggingIndex = null;
    }
}
