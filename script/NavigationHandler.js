class NavigationHandler {
    constructor(deps = {}, buttonIds = {}) {
        this.updateGameModeUI = deps.updateGameModeUI;
        this.startGame = deps.startGame;
        this.renderLetterTiles = deps.renderLetterTiles;
        this.getGameState = deps.getGameState;
        this.getNormalGameStats = deps.getNormalGameStats;

        this.buttonIds = {
            check: buttonIds.check || 'btn-check',
            game: buttonIds.game || 'btn-game',
            stats: buttonIds.stats || 'btn-stats',
            bots: buttonIds.bots || 'btn-bots'
        };
        this.gifModeActive = false;
        this.isSetup = false;
    }

    updateChosenNavigationButton(name) {
        const buttonMap = {
            check: this.buttonIds.check,
            game: this.buttonIds.game,
            stats: this.buttonIds.stats,
            bots: this.buttonIds.bots
        };

        const activeButtonId = buttonMap[name];
        if (!activeButtonId) return;

        const buttons = document.querySelectorAll('.navigation-btn');
        buttons.forEach(button => {
            button.classList.toggle('chosen', button.id === activeButtonId);
        });
    }

    async showSection(name) {
        const sections = document.querySelectorAll('.page-section');
        sections.forEach(s => s.style.display = s.id === name + '-section' ? '' : 'none');
        this.updateChosenNavigationButton(name);
        if (typeof this.updateGameModeUI === 'function') {
            this.updateGameModeUI();
        }

        if (name !== 'game') return;

        const gameState = this.getGameState ? this.getGameState() : null;
        const normalGameStats = this.getNormalGameStats ? this.getNormalGameStats() : null;

        if (this.gifModeActive && gameState && normalGameStats) {
            normalGameStats.totalFound = 99;
            normalGameStats.totalSolutions = 99;
            if (typeof this.updateGameModeUI === 'function') {
                this.updateGameModeUI();
            }
            if (typeof this.startGame === 'function') {
                await this.startGame();
            }
            gameState.letters = 'ukcharz';
            gameState.solutions = ['kucharz'];
            gameState.count = 7;
            if (typeof this.renderLetterTiles === 'function') {
                this.renderLetterTiles();
            }
            this.gifModeActive = false;
        }

        // only initialize game once; subsequent navigations keep current state
        if (gameState && !gameState.letters && typeof this.startGame === 'function') {
            // start game loading in background (don't block section display)
            this.startGame().catch(err => console.error('Game initialization failed:', err));
        }
    }

    navigateTo(name) {
        // redirect any "home" requests to the check page as it's now the landing screen
        if (name === 'home') name = 'game';
        location.hash = name;
        this.showSection(name);
    }

    handleHashChange() {
        const hashes = location.hash.replace(/^#/, '').split('&');
        const hash = hashes[0];
        if (hashes.length > 1 && hashes[1] === 'oneHundredGift') {
            this.gifModeActive = true;
        }
        if (!hash) return this.navigateTo('game');
        if (['check', 'game', 'stats', 'bots'].includes(hash)) {
            this.showSection(hash);
        } else {
            this.navigateTo('game');
        }
    }

    setup() {
        if (this.isSetup) return;
        this.isSetup = true;

        const btnCheck = document.getElementById(this.buttonIds.check);
        const btnGame = document.getElementById(this.buttonIds.game);
        const btnStats = document.getElementById(this.buttonIds.stats);

        const btnBots = document.getElementById(this.buttonIds.bots);

        if (btnCheck) btnCheck.addEventListener('click', () => this.navigateTo('check'));
        if (btnGame) btnGame.addEventListener('click', () => this.navigateTo('game'));
        if (btnStats) btnStats.addEventListener('click', () => this.navigateTo('stats'));
        if (btnBots) btnBots.addEventListener('click', () => this.navigateTo('bots'));

        window.addEventListener('hashchange', () => this.handleHashChange());
    }
}