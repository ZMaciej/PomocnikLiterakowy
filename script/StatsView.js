class StatsView {
  constructor(options = {}) {
    this.getWordSet = options.getWordSet;
    this.sectionId = options.sectionId || 'stats-section';
    this.minLength = options.minLength || 2;
    this.maxLength = options.maxLength || 10;

    this.sectionEl = null;
    this.lengthsWrapEl = null;
    this.toggleAllBtn = null;
    this.renderBtn = null;
    this.statusEl = null;
    this.resultsEl = null;

    this.sjp = null;
    this.statsGenerator = null;
    this.cacheByLength = new Map();
    this.isSetup = false;
  }

  setup() {
    if (this.isSetup) return;
    this.isSetup = true;

    this.sectionEl = document.getElementById(this.sectionId);
    if (!this.sectionEl) return;

    this.buildLayout();
    this.bindEvents();
  }

  buildLayout() {
    this.sectionEl.innerHTML = '';

    const title = document.createElement('h3');
    title.className = 'stats-title';
    title.textContent = 'Statystyki słownika';

    const controls = document.createElement('div');
    controls.className = 'stats-controls';

    const controlsTop = document.createElement('div');
    controlsTop.className = 'stats-controls-top';

    this.toggleAllBtn = document.createElement('button');
    this.toggleAllBtn.id = 'stats-toggle-all';
    this.toggleAllBtn.textContent = 'Odznacz wszystkie (2-15)';

    this.renderBtn = document.createElement('button');
    this.renderBtn.id = 'stats-generate';
    this.renderBtn.textContent = 'Pokaż statystyki';

    controlsTop.appendChild(this.toggleAllBtn);
    controlsTop.appendChild(this.renderBtn);

    const lengthsLabel = document.createElement('p');
    lengthsLabel.className = 'stats-length-label';
    lengthsLabel.textContent = 'Liczba liter';

    this.lengthsWrapEl = document.createElement('div');
    this.lengthsWrapEl.className = 'stats-length-checkboxes';
    for (let len = this.minLength; len <= this.maxLength; len++) {
      const item = document.createElement('label');
      item.className = 'stats-length-item';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(len);
      input.checked = len === 7;

      const text = document.createElement('span');
      text.textContent = String(len);

      item.appendChild(input);
      item.appendChild(text);
      this.lengthsWrapEl.appendChild(item);
    }

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'stats-status';

    controls.appendChild(controlsTop);
    controls.appendChild(lengthsLabel);
    controls.appendChild(this.lengthsWrapEl);
    controls.appendChild(this.statusEl);

    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'stats-results';

    this.sectionEl.appendChild(title);
    this.sectionEl.appendChild(controls);
    this.sectionEl.appendChild(this.resultsEl);

    this.updateToggleAllButtonLabel();
  }

  bindEvents() {
    this.toggleAllBtn.addEventListener('click', () => {
      const checkboxes = this.getLengthCheckboxes();
      const allChecked = checkboxes.every(cb => cb.checked);
      checkboxes.forEach(cb => {
        cb.checked = !allChecked;
      });
      this.updateToggleAllButtonLabel();
    });

    this.renderBtn.addEventListener('click', () => {
      this.renderForSelectedLengths().catch(err => {
        console.error('Failed to render stats', err);
        this.statusEl.textContent = 'Nie udało się wygenerować statystyk.';
      });
    });

    this.lengthsWrapEl.addEventListener('change', () => {
      this.updateToggleAllButtonLabel();
    });
  }

  getLengthCheckboxes() {
    return Array.from(this.lengthsWrapEl.querySelectorAll('input[type="checkbox"]'));
  }

  getSelectedLengths() {
    return this.getLengthCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => Number(cb.value))
      .sort((a, b) => a - b);
  }

  updateToggleAllButtonLabel() {
    const allChecked = this.getLengthCheckboxes().every(cb => cb.checked);
    this.toggleAllBtn.textContent = allChecked
      ? `Odznacz wszystkie (${this.minLength}-${this.maxLength})`
      : `Zaznacz wszystkie (${this.minLength}-${this.maxLength})`;
  }

  async ensureStatsGenerator() {
    if (this.statsGenerator) {
      return this.statsGenerator;
    }

    if (typeof this.getWordSet !== 'function') {
      throw new Error('StatsView requires getWordSet function');
    }

    this.statusEl.textContent = 'Ładowanie słownika...';
    this.sjp = await this.getWordSet();
    this.statsGenerator = new SjpStatsGenerator(this.sjp);

    return this.statsGenerator;
  }

  async renderForSelectedLengths() {
    const selectedLengths = this.getSelectedLengths();
    if (!selectedLengths.length) {
      this.resultsEl.innerHTML = '';
      this.statusEl.textContent = 'Wybierz co najmniej jedną długość słowa.';
      return;
    }

    this.statusEl.textContent = `Generowanie statystyk dla długości: ${selectedLengths.join(', ')}...`;

    const generator = await this.ensureStatsGenerator();

    const statsByLength = [];
    for (const len of selectedLengths) {
      let cached = this.cacheByLength.get(len);
      if (!cached) {
        const letterFrequency = generator.generateLetterFrequencyStats(len);
        const prefixSuffix = generator.generatePrefixSuffixStats({
          wordLength: len,
          topN: 8,
          prefixLength: 2,
          suffixLength: 2
        });
        const ratioData = generator.generateVowelConsonantRatioStats(len);
        const ratioStats = ratioData.byLength[len] || null;
        const maxAnagramStats = generator.generateMaxAnagramStats(len);
        const combinations = generator.generateFrequentLetterCombinationsStats(len, [2, 3, 4], 8);
        const topScored = generator.generateTopScoredWordsByLengthStats({
          minLength: len,
          maxLength: len,
          topN: 10,
          respectLetterCounts: true
        });

        cached = {
          length: len,
          letterFrequency,
          prefixSuffix,
          ratioStats,
          maxAnagramStats,
          combinations,
          topScored: topScored.byLength[len] || []
        };
        this.cacheByLength.set(len, cached);
      }

      statsByLength.push(cached);
    }

    this.renderResults(statsByLength);
    this.statusEl.textContent = `Gotowe. Pokazano statystyki dla długości: ${selectedLengths.join(', ')}.`;
  }

  renderResults(statsByLength) {
    this.resultsEl.innerHTML = '';

    for (const stats of statsByLength) {
      const lengthSection = document.createElement('section');
      lengthSection.className = 'stats-block';

      const title = document.createElement('h4');
      title.textContent = `${stats.length} liter`;
      lengthSection.appendChild(title);

      lengthSection.appendChild(this.renderMaxAnagramsPanel(stats));
      lengthSection.appendChild(this.renderLetterFrequencyPanel(stats));
      lengthSection.appendChild(this.renderPrefixSuffixPanel(stats));
      lengthSection.appendChild(this.renderVowelRatioPanel(stats));
      lengthSection.appendChild(this.renderCombinationsPanel(stats));
      lengthSection.appendChild(this.renderTopScoredPanel(stats));

      this.resultsEl.appendChild(lengthSection);
    }
  }

  renderLetterFrequencyPanel(stats) {
    const panel = this.createPanel('Najczęstsze litery (top 10)');
    const table = this.createTable(['Litera', 'Liczba', 'Najczęstsza pozycja']);

    const top = stats.letterFrequency.letters.slice(0, 10);
    for (const item of top) {
      const entries = Object.entries(item.positionCounts)
        .map(([position, count]) => ({ position: Number(position), count }))
        .sort((a, b) => b.count - a.count || a.position - b.position);

      const bestPos = entries.length ? `${entries[0].position} (${entries[0].count})` : '-';
      this.appendRow(table.tbody, [item.letter, String(item.totalCount), bestPos]);
    }

    panel.appendChild(table.table);
    return panel;
  }

  renderMaxAnagramsPanel(stats) {
    const panel = this.createPanel('Największa liczba anagramów (dla tej długości)');
    const data = stats.maxAnagramStats;

    const lead = document.createElement('p');
    lead.textContent = `Maksymalna liczba anagramów w grupie: ${data.maxAnagramCount}`;
    panel.appendChild(lead);

    const list = document.createElement('ul');
    list.className = 'stats-simple-list';

    if (!data.groups.length) {
      const li = document.createElement('li');
      li.textContent = 'Brak danych';
      list.appendChild(li);
      panel.appendChild(list);
      return panel;
    }

    data.groups.slice(0, 8).forEach(group => {
      const li = document.createElement('li');
      li.textContent = group.words.join(', ');
      list.appendChild(li);
    });

    panel.appendChild(list);
    return panel;
  }

  renderPrefixSuffixPanel(stats) {
    const panel = this.createPanel('Najczęstsze początki/końcówki (2-znakowe, top 8)');

    const grid = document.createElement('div');
    grid.className = 'stats-two-columns';

    const prefixesWrap = document.createElement('div');
    const prefixesTitle = document.createElement('h5');
    prefixesTitle.textContent = 'Początki';
    prefixesWrap.appendChild(prefixesTitle);
    prefixesWrap.appendChild(this.createSimpleCountList(stats.prefixSuffix.overall.prefixes));

    const suffixesWrap = document.createElement('div');
    const suffixesTitle = document.createElement('h5');
    suffixesTitle.textContent = 'Końcówki';
    suffixesWrap.appendChild(suffixesTitle);
    suffixesWrap.appendChild(this.createSimpleCountList(stats.prefixSuffix.overall.suffixes));

    grid.appendChild(prefixesWrap);
    grid.appendChild(suffixesWrap);
    panel.appendChild(grid);

    return panel;
  }

  renderVowelRatioPanel(stats) {
    const panel = this.createPanel('Stosunek spółgłosek do samogłosek');
    const ratio = stats.ratioStats;

    if (!ratio) {
      const p = document.createElement('p');
      p.textContent = 'Brak danych dla tej długości.';
      panel.appendChild(p);
      return panel;
    }

    const list = document.createElement('ul');
    list.className = 'stats-simple-list';

    const i1 = document.createElement('li');
    i1.textContent = `Liczba słów: ${ratio.wordsCount}`;
    const i2 = document.createElement('li');
    i2.textContent = `Średnia (spółgłoski/samogłoski): ${ratio.averageConsonantsToVowelsRatio.toFixed(3)}`;
    const i3 = document.createElement('li');
    i3.textContent = `Mediana (spółgłoski/samogłoski): ${ratio.medianConsonantsToVowelsRatio.toFixed(3)}`;

    list.appendChild(i1);
    list.appendChild(i2);
    list.appendChild(i3);

    panel.appendChild(list);
    return panel;
  }

  renderCombinationsPanel(stats) {
    const panel = this.createPanel('Najczęstsze kombinacje liter (2/3/4)');

    const wrapper = document.createElement('div');
    wrapper.className = 'stats-three-columns';

    ['2', '3', '4'].forEach(size => {
      const box = document.createElement('div');
      const title = document.createElement('h5');
      title.textContent = `${size} litery`;
      box.appendChild(title);

      const data = stats.combinations.byCombinationSize[size] || [];
      box.appendChild(this.createSimpleCountList(data.map(item => ({
        chunk: item.combination,
        count: item.count
      }))));

      wrapper.appendChild(box);
    });

    panel.appendChild(wrapper);
    return panel;
  }

  renderTopScoredPanel(stats) {
    const panel = this.createPanel('Najwyżej punktowane słowa (z limitem liter)');
    const table = this.createTable(['Słowo', 'Punkty']);

    for (const item of stats.topScored) {
      this.appendRow(table.tbody, [item.word, String(item.score)]);
    }

    panel.appendChild(table.table);
    return panel;
  }

  createPanel(titleText) {
    const panel = document.createElement('article');
    panel.className = 'stats-panel';

    const title = document.createElement('h5');
    title.className = 'stats-panel-title';
    title.textContent = titleText;

    panel.appendChild(title);
    return panel;
  }

  createSimpleCountList(entries) {
    const list = document.createElement('ul');
    list.className = 'stats-simple-list';

    entries.forEach(item => {
      const li = document.createElement('li');
      const key = item.chunk || item.combination || '-';
      li.textContent = `${key}: ${item.count}`;
      list.appendChild(li);
    });

    if (!entries.length) {
      const li = document.createElement('li');
      li.textContent = 'Brak danych';
      list.appendChild(li);
    }

    return list;
  }

  createTable(headers) {
    const table = document.createElement('table');
    table.className = 'stats-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');

    table.appendChild(thead);
    table.appendChild(tbody);

    return { table, tbody };
  }

  appendRow(tbody, values) {
    const tr = document.createElement('tr');
    values.forEach(value => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

window.StatsView = StatsView;
