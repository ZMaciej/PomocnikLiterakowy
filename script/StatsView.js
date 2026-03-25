class StatsView {
  constructor(options = {}) {
    this.getWordSet = options.getWordSet;
    this.sectionId = options.sectionId || 'stats-section';
    this.minLength = options.minLength || 2;
    this.maxLength = options.maxLength || 15;

    this.sectionEl = null;
    this.lengthsWrapEl = null;
    this.toggleAllBtn = null;
    this.renderBtn = null;
    this.statusEl = null;
    this.resultsEl = null;
    this.queryInputEl = null;
    this.queryModeCheckboxEl = null;
    this.queryButtonEl = null;

    this.sjp = null;
    this.statsGenerator = null;
    this.precomputedStats = null;
    this.isSetup = false;
    this.lastRenderedCombinedStats = null;
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

    const queryWrap = document.createElement('div');
    queryWrap.className = 'stats-controls';

    const queryLabel = document.createElement('p');
    queryLabel.className = 'stats-length-label';
    queryLabel.textContent = 'Ciąg 1-4 znakowy';

    const queryControlsTop = document.createElement('div');
    queryControlsTop.className = 'stats-controls-top';

    this.queryInputEl = document.createElement('input');
    this.queryInputEl.type = 'text';
    this.queryInputEl.maxLength = 4;
    this.queryInputEl.placeholder = 'np. nie';
    this.queryInputEl.className = 'stats-query-input';

    const checkboxWrap = document.createElement('label');
    checkboxWrap.className = 'stats-length-item';

    this.queryModeCheckboxEl = document.createElement('input');
    this.queryModeCheckboxEl.type = 'checkbox';
    this.queryModeCheckboxEl.checked = true;

    const checkboxText = document.createElement('span');
    checkboxText.textContent = 'Dokładny ciąg';

    checkboxWrap.appendChild(this.queryModeCheckboxEl);
    checkboxWrap.appendChild(checkboxText);

    this.queryButtonEl = document.createElement('button');
    this.queryButtonEl.textContent = 'Pokaż statystyki ciągu';
    this.queryButtonEl.className = 'stats-query-button';

    queryControlsTop.appendChild(this.queryInputEl);
    queryControlsTop.appendChild(checkboxWrap);
    queryControlsTop.appendChild(this.queryButtonEl);
    queryWrap.appendChild(queryLabel);
    queryWrap.appendChild(queryControlsTop);

    this.statusEl = document.createElement('p');
    this.statusEl.className = 'stats-status';

    controls.appendChild(controlsTop);
    controls.appendChild(lengthsLabel);
    controls.appendChild(this.lengthsWrapEl);
    controls.appendChild(queryWrap);
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

    this.queryButtonEl.addEventListener('click', () => {
      this.renderForSelectedLengths().catch(err => {
        console.error('Failed to render query stats', err);
        this.statusEl.textContent = 'Nie udało się wygenerować statystyk ciągu.';
      });
    });

    this.queryInputEl.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.renderForSelectedLengths().catch(err => {
        console.error('Failed to render query stats', err);
        this.statusEl.textContent = 'Nie udało się wygenerować statystyk ciągu.';
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
    this.precomputedStats = typeof this.sjp.getAggregatedStats === 'function'
      ? this.sjp.getAggregatedStats()
      : null;
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

    await this.ensureStatsGenerator();

    const combinedStats = typeof this.sjp.getCombinedAggregatedStats === 'function'
      ? this.sjp.getCombinedAggregatedStats(selectedLengths)
      : null;

    if (!combinedStats) {
      this.resultsEl.innerHTML = '';
      this.statusEl.textContent = 'Brak zagregowanych statystyk dla wybranego zbioru długości.';
      return;
    }

    this.lastRenderedCombinedStats = combinedStats;
    this.renderResults(combinedStats);
    this.statusEl.textContent = `Gotowe. Pokazano statystyki dla długości: ${selectedLengths.join(', ')}.`;
  }

  renderResults(combinedStats) {
    this.resultsEl.innerHTML = '';

    const block = document.createElement('section');
    block.className = 'stats-block stats-block-spotlight';

    const title = document.createElement('h4');
    title.textContent = `Długości: ${combinedStats.lengths.join(', ')}`;
    block.appendChild(title);

    block.appendChild(this.renderOverviewPanel(combinedStats));
    block.appendChild(this.renderLetterFrequencyPanel(combinedStats));
    block.appendChild(this.renderPrefixSuffixPanel(combinedStats));
    block.appendChild(this.renderSubstringPanel(combinedStats));
    block.appendChild(this.renderLettersAnywherePanel(combinedStats));
    block.appendChild(this.renderQueryPanel(combinedStats));
    block.appendChild(this.renderTopScoredPanel(combinedStats));
    block.appendChild(this.renderMaxAnagramsPanel(combinedStats));
    block.appendChild(this.renderVowelRatioPanel(combinedStats));

    this.resultsEl.appendChild(block);
  }

  renderOverviewPanel(stats) {
    const panel = this.createPanel('Podsumowanie długości');
    const table = this.createTable(['Długość', 'Liczba słów', '% całego słownika']);
    const totalDictionaryWords = this.precomputedStats?.totalWords || stats.wordCount;

    stats.lengths.forEach(length => {
      const count = stats.wordCountByLength[length] || 0;
      const percentage = this.formatPercent(totalDictionaryWords > 0 ? count / totalDictionaryWords : 0);
      this.appendRow(table.tbody, [String(length), String(count), percentage]);
    });

    panel.appendChild(table.table);

    const summary = document.createElement('p');
    summary.textContent = `Łącznie ${stats.wordCount} słów, czyli ${this.formatPercent(stats.shareOfAllWords)} całego słownika.`;
    panel.appendChild(summary);

    return panel;
  }

  renderLetterFrequencyPanel(stats) {
    const panel = this.createPanel('Najpopularniejsze litery (top 10)');
    const table = this.createTable(['Najczęstsza pozycja', 'Litera', 'Liczba', '% wszystkich liter']);

    stats.letterFrequency.letters.slice(0, 10).forEach(item => {
      const entries = item.positionCounts
        .map((count, index) => ({ position: index + 1, count }))
        .filter(entry => entry.count > 0)
        .sort((a, b) => b.count - a.count || a.position - b.position);

      const bestPos = entries.length ? `${entries[0].position} (${entries[0].count})` : '-';
      this.appendRow(table.tbody, [
        bestPos,
        item.letter,
        String(item.totalCount),
        this.formatPercent(item.percentageOfLetters)
      ]);
    });

    panel.appendChild(table.table);
    return panel;
  }

  renderPrefixSuffixPanel(stats) {
    const panel = this.createPanel('Najpopularniejsze początki i końcówki 2-4 literowe');

    ['2', '3', '4'].forEach(size => {
      const subtitle = document.createElement('h5');
      subtitle.textContent = `${size} litery`;
      panel.appendChild(subtitle);

      const grid = document.createElement('div');
      grid.className = 'stats-two-columns';

      const prefixesWrap = document.createElement('div');
      const prefixesTitle = document.createElement('h5');
      prefixesTitle.textContent = 'Początki';
      prefixesWrap.appendChild(prefixesTitle);
      prefixesWrap.appendChild(this.createSimpleCountList(stats.prefixSuffix.prefixes[size] || [], {
        keyField: 'chunk',
        valueFormatter: item => `${item.count} (${this.formatPercent(item.percentageOfWords)})`
      }));

      const suffixesWrap = document.createElement('div');
      const suffixesTitle = document.createElement('h5');
      suffixesTitle.textContent = 'Końcówki';
      suffixesWrap.appendChild(suffixesTitle);
      suffixesWrap.appendChild(this.createSimpleCountList(stats.prefixSuffix.suffixes[size] || [], {
        keyField: 'chunk',
        valueFormatter: item => `${item.count} (${this.formatPercent(item.percentageOfWords)})`
      }));

      grid.appendChild(prefixesWrap);
      grid.appendChild(suffixesWrap);
      panel.appendChild(grid);
    });

    return panel;
  }

  renderSubstringPanel(stats) {
    const panel = this.createPanel('Najczęstsze ciągi literowe 2-4 literowe');
    const wrapper = document.createElement('div');
    wrapper.className = 'stats-three-columns';

    ['2', '3', '4'].forEach(size => {
      const box = document.createElement('div');
      const title = document.createElement('h5');
      title.textContent = `${size} litery`;
      box.appendChild(title);
      box.appendChild(this.createSimpleCountList(stats.substringStats.exact[size]?.top || [], {
        keyField: 'value',
        valueFormatter: item => `${item.wordCount} (${this.formatPercent(item.percentageOfWords)})`
      }));
      wrapper.appendChild(box);
    });

    panel.appendChild(wrapper);
    return panel;
  }

  renderLettersAnywherePanel(stats) {
    const panel = this.createPanel('Najczęściej występujące litery razem');
    const wrapper = document.createElement('div');
    wrapper.className = 'stats-three-columns';

    ['2', '3', '4'].forEach(size => {
      const box = document.createElement('div');
      const title = document.createElement('h5');
      title.textContent = `${size} litery`;
      box.appendChild(title);
      box.appendChild(this.createSimpleCountList(stats.substringStats.lettersAnywhere[size]?.top || [], {
        keyField: 'value',
        valueFormatter: item => `${item.wordCount} (${this.formatPercent(item.percentageOfWords)})`
      }));
      wrapper.appendChild(box);
    });

    panel.appendChild(wrapper);
    return panel;
  }

  renderQueryPanel(stats) {
    const panel = this.createPanel('Statystyki dla wpisanego ciągu');
    const query = this.getNormalizedQueryValue();
    if (!query) {
      const p = document.createElement('p');
      p.textContent = 'Wpisz ciąg 1-4 znakowy, aby zobaczyć jego statystyki.';
      panel.appendChild(p);
      return panel;
    }

    const exactMode = this.queryModeCheckboxEl.checked;
    const sourceSection = exactMode
      ? stats.substringStats.exact[query.length]
      : stats.substringStats.lettersAnywhere[query.length];
    const lookupValue = exactMode ? query : [...query].sort((a, b) => a.localeCompare(b, 'pl')).join('');
    const entry = (sourceSection?.entries || []).find(item => item.value === lookupValue);

    if (!entry) {
      const p = document.createElement('p');
      p.textContent = `Brak danych dla ciągu „${query}”.`;
      panel.appendChild(p);
      return panel;
    }

    const list = document.createElement('ul');
    list.className = 'stats-simple-list';
    list.appendChild(this.createListItem(`Tryb: ${exactMode ? 'dokładny ciąg' : 'litery gdziekolwiek w słowie'}`));
    list.appendChild(this.createListItem(`Liczba słów: ${entry.wordCount}`));
    list.appendChild(this.createListItem(`Procent słów: ${this.formatPercent(entry.percentageOfWords)}`));
    if (exactMode) {
      list.appendChild(this.createListItem(`Liczba wszystkich wystąpień: ${entry.totalOccurrences}`));
    }
    panel.appendChild(list);

    if (exactMode && Array.isArray(entry.startPositions)) {
      if (stats.lengths.length === 1) {
        const chartLabel = document.createElement('h5');
        chartLabel.textContent = `Pozycje startu ciągu (długość słów: ${stats.lengths[0]})`;
        panel.appendChild(chartLabel);
        panel.appendChild(this.createPositionChart(entry.startPositions, entry.totalOccurrences || 0));
      } else {
        const note = document.createElement('p');
        note.textContent = 'Wykres pozycji jest dostępny przy wyborze jednej długości słowa.';
        panel.appendChild(note);
      }

      const table = this.createTable(['Pozycja startu', 'Liczba', 'Udział']);
      const totalOccurrences = entry.totalOccurrences || 0;
      entry.startPositions.forEach((count, index) => {
        const share = totalOccurrences > 0 ? count / totalOccurrences : 0;
        this.appendRow(table.tbody, [String(index + 1), String(count), this.formatPercent(share)]);
      });
      panel.appendChild(table.table);
    }

    const examplesHeader = document.createElement('h5');
    examplesHeader.textContent = 'Przykładowe słowa';
    panel.appendChild(examplesHeader);
    panel.appendChild(this.createSimpleCountList((entry.sampleWords || []).map(word => ({ word })), {
      keyField: 'word',
      valueFormatter: () => ''
    }));

    return panel;
  }

  renderTopScoredPanel(stats) {
    const panel = this.createPanel('Najwyżej punktowane słowa (top 10)');
    const table = this.createTable(['Słowo', 'Punkty', 'Punkty / litera']);

    for (const item of stats.topScoredWords || []) {
      this.appendRow(table.tbody, [item.word, String(item.score), item.scorePerLetter.toFixed(2)]);
    }

    panel.appendChild(table.table);
    return panel;
  }

  renderMaxAnagramsPanel(stats) {
    const panel = this.createPanel('Słowa z największą liczbą anagramów (top 10)');
    const table = this.createTable(['Liczba anagramów', 'Słowa']);

    if (!stats.topAnagramGroups || !stats.topAnagramGroups.length) {
      this.appendRow(table.tbody, ['0', 'Brak danych']);
    } else {
      for (const group of stats.topAnagramGroups) {
        this.appendRow(table.tbody, [String(group.count), group.words.join(', ')]);
      }
    }

    panel.appendChild(table.table);
    return panel;
  }

  renderVowelRatioPanel(stats) {
    const panel = this.createPanel('Stosunek spółgłosek do samogłosek');
    const ratio = stats.vowelConsonantRatio;

    if (!ratio) {
      const p = document.createElement('p');
      p.textContent = 'Brak danych dla tej długości.';
      panel.appendChild(p);
      return panel;
    }

    const list = document.createElement('ul');
    list.className = 'stats-simple-list';
    list.appendChild(this.createListItem(`Liczba słów: ${ratio.wordsCount}`));
    list.appendChild(this.createListItem(`Średnia (spółgłoski/samogłoski): ${ratio.averageConsonantsToVowelsRatio.toFixed(3)}`));
    list.appendChild(this.createListItem(`Mediana (spółgłoski/samogłoski): ${ratio.medianConsonantsToVowelsRatio.toFixed(3)}`));
    list.appendChild(this.createListItem(`Słów bez samogłosek: ${ratio.wordsWithoutVowels}`));

    panel.appendChild(list);
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

  createSimpleCountList(entries, options = {}) {
    const keyField = options.keyField || 'chunk';
    const valueFormatter = typeof options.valueFormatter === 'function'
      ? options.valueFormatter
      : item => String(item.count ?? '');
    const list = document.createElement('ul');
    list.className = 'stats-simple-list';

    entries.forEach(item => {
      const li = document.createElement('li');
      const key = item[keyField] || item.chunk || item.combination || item.value || '-';
      const value = valueFormatter(item);
      li.textContent = value ? `${key}: ${value}` : key;
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

  createPositionChart(startPositions, totalOccurrences) {
    const chart = document.createElement('div');
    chart.className = 'stats-position-chart';
    const maxCount = Math.max(1, ...startPositions);

    startPositions.forEach((count, index) => {
      const row = document.createElement('div');
      row.className = 'stats-position-row';

      const label = document.createElement('div');
      label.className = 'stats-position-label';
      label.textContent = String(index + 1);

      const track = document.createElement('div');
      track.className = 'stats-position-track';

      const fill = document.createElement('div');
      fill.className = 'stats-position-fill';
      fill.style.width = `${(count / maxCount) * 100}%`;
      track.appendChild(fill);

      const value = document.createElement('div');
      value.className = 'stats-position-value';
      const share = totalOccurrences > 0 ? count / totalOccurrences : 0;
      value.textContent = `${count} (${this.formatPercent(share)})`;

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      chart.appendChild(row);
    });

    return chart;
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

  createListItem(text) {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }

  formatPercent(value) {
    return `${(value * 100).toFixed(2)}%`;
  }

  getNormalizedQueryValue() {
    const rawValue = (this.queryInputEl?.value || '').trim().toUpperCase();
    if (!rawValue) {
      return '';
    }

    return [...rawValue].slice(0, 4).join('');
  }
}

window.StatsView = StatsView;
