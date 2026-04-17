class LoadingController {
    constructor() {
        this._startTime = 0;
        this._frameId = null;
    }

    updateStatus(msg) {
        const statusEl = document.getElementById('statusText');
        if (statusEl) statusEl.textContent = msg;
        const alt = document.getElementById('statusTextGame');
        if (alt) alt.textContent = msg;
        const loading = document.getElementById('loading-status');
        if (loading) loading.textContent = msg;
    }

    updateProgress(percent) {
        const prog = document.getElementById('loading-progress');
        const pageProgress = document.getElementById('progress');
        if (prog) prog.value = percent;
        if (pageProgress) pageProgress.value = percent;
    }

    hideScreen() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    _formatSeconds(ms) {
        return `(${(ms / 1000).toFixed(1)}s)`;
    }

    _updateTimeDisplay(ms) {
        const el = document.getElementById('loading-time');
        if (el) el.textContent = this._formatSeconds(ms);
    }

    startTimer() {
        this._startTime = performance.now();
        this._updateTimeDisplay(0);

        if (this._frameId) cancelAnimationFrame(this._frameId);

        const tick = () => {
            this._updateTimeDisplay(performance.now() - this._startTime);
            this._frameId = requestAnimationFrame(tick);
        };
        this._frameId = requestAnimationFrame(tick);
    }

    stopTimer() {
        if (this._frameId) {
            cancelAnimationFrame(this._frameId);
            this._frameId = null;
        }

        if (this._startTime > 0) {
            const elapsed = performance.now() - this._startTime;
            this._updateTimeDisplay(elapsed);
            return elapsed;
        }
        return 0;
    }
}
