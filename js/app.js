// UI制御：体重キーパッド → 不整脈選択 → 体重確認 → 薬剤カード描画、フローチャートモーダル表示
// 画面遷移はアニメーションなし（緊急時の視認性優先）。計算は calculator.js、データは drugData.js に委譲。

(function () {
  // 不整脈カテゴリの色分け（暗所での識別用。データ側の id に対応）
  const CATEGORY_STYLE = {
    psvt: { color: '#5fd4c4', tag: 'PSVT・頻拍停止' },
    afib_aflutter: { color: '#e6b45c', tag: 'レートコントロール' },
    vt_stable: { color: '#f0956a', tag: 'VT・脈あり' },
    vf_pulseless_vt: { color: '#ff8a7a', tag: '心停止' },
    bradycardia: { color: '#7fb6e6', tag: '徐脈・房室ブロック' },
    tdp_polymorphic_vt: { color: '#c79bdf', tag: 'TdP・多形性VT' },
  };

  const MAX_DIGITS = 4; // 体重は最大4桁（例: 72.5）

  const screens = {
    weight: document.getElementById('screenWeight'),
    category: document.getElementById('screenCategory'),
    confirm: document.getElementById('screenConfirm'),
    result: document.getElementById('screenResult'),
  };

  const keypad = document.getElementById('keypad');
  const weightValueEl = document.getElementById('weightValue');
  const toCategoryBtn = document.getElementById('toCategoryBtn');
  const backToWeightBtn = document.getElementById('backToWeightBtn');
  const backWeightEl = document.getElementById('backWeight');
  const categoryButtonsEl = document.getElementById('categoryButtons');
  const confirmCategoryEl = document.getElementById('confirmCategory');
  const confirmWeightEl = document.getElementById('confirmWeight');
  const confirmBtn = document.getElementById('confirmBtn');
  const editWeightBtn = document.getElementById('editWeightBtn');
  const editCategoryBtn = document.getElementById('editCategoryBtn');
  const resetBtn = document.getElementById('resetBtn');
  const resultTitle = document.getElementById('resultTitle');
  const resultWeightEl = document.getElementById('resultWeight');
  const itemListEl = document.getElementById('itemList');
  const flowchartBtn = document.getElementById('flowchartBtn');

  const modal = document.getElementById('flowchartModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalClose = document.getElementById('modalClose');
  const modalTabs = document.getElementById('modalTabs');
  const modalImage = document.getElementById('modalImage');
  const modalSource = document.getElementById('modalSource');
  const modalImageWrap = document.getElementById('modalImageWrap');
  const footerSourcesEl = document.getElementById('footerSources');

  let weightText = '';          // キーパッドで入力中の文字列
  let selectedCategoryId = null;
  let weightConfirmed = false;  // 体重確認ステップを通過したか

  function getWeight() {
    const v = parseFloat(weightText);
    return isFinite(v) && v > 0 ? v : null;
  }

  function weightDisplay() {
    return weightText === '' ? '0.0' : weightText;
  }

  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].dataset.active = key === name ? 'true' : 'false';
    });
    window.scrollTo(0, 0);
  }

  // 出典表示：Web上のURLを持つ出典のみリンクにし、ローカルPDFのみの出典はテキスト表示
  function renderFooterSources() {
    if (!footerSourcesEl) return;
    footerSourcesEl.textContent = '出典: ';
    Object.keys(GUIDELINE_SOURCES).forEach((key, idx) => {
      const src = GUIDELINE_SOURCES[key];
      if (idx > 0) footerSourcesEl.appendChild(document.createTextNode('／'));
      if (src.url) {
        const a = document.createElement('a');
        a.className = 'footer-source-link';
        a.href = src.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = src.title;
        footerSourcesEl.appendChild(a);
      } else {
        footerSourcesEl.appendChild(document.createTextNode(src.title));
      }
    });
  }

  function fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    return (Math.round(n * 1000) / 1000).toString();
  }

  function fmtPercent(n) {
    if (n == null || !isFinite(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return sign + (Math.round(n * 10) / 10).toString() + '%';
  }

  // 検算用：標準投与量（mg/kg・J/kg・μg/kg/分）をそのまま表示するテキストを作る
  function standardDoseText(item) {
    const isRange = item.dosePerKg == null;
    const low = item.dosePerKg != null ? item.dosePerKg : item.doseMinPerKg;
    const high = item.dosePerKg != null ? item.dosePerKg : item.doseMaxPerKg;
    const unit = item.doseType === 'joulePerKg' ? 'J/kg'
      : item.doseType === 'mcgPerKgMin' ? 'μg/kg/分'
      : 'mg/kg';
    const valueText = isRange && low !== high ? fmt(low) + '〜' + fmt(high) : fmt(low);
    return '標準投与量: ' + valueText + ' ' + unit;
  }

  // 検算用：丸めによる標準投与量からのずれ（％）を、10％超なら警告付きで表示するHTML断片を作る
  function deviationHtml(r) {
    const pairs = [];
    if (r.deviationPercentLow != null) pairs.push({ pct: r.deviationPercentLow, warn: r.deviationWarnLow });
    if (r.deviationPercentHigh != null && r.deviationPercentHigh !== r.deviationPercentLow) {
      pairs.push({ pct: r.deviationPercentHigh, warn: r.deviationWarnHigh });
    }
    if (!pairs.length) return '';
    const anyWarn = pairs.some((p) => p.warn);
    const pctText = pairs.map((p) => fmtPercent(p.pct)).join(' 〜 ');
    const cls = anyWarn ? 'deviation-note deviation-warn' : 'deviation-note';
    const prefix = anyWarn ? '⚠️ ' : '検算: ';
    const suffix = anyWarn
      ? '（標準投与量から10％を超えてずれています。丸め方向・投与量を確認してください）'
      : '（丸めによる標準投与量からのずれ）';
    return '<div class="' + cls + '">' + prefix + '丸め後の実投与量は標準投与量比 ' + pctText + ' ' + suffix + '</div>';
  }

  // --- 1. 体重入力 ---------------------------------------------------------
  function renderWeight() {
    const text = weightDisplay();
    weightValueEl.textContent = text;
    backWeightEl.textContent = text;
    toCategoryBtn.disabled = !getWeight();
  }

  keypad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === 'del') {
      weightText = weightText.slice(0, -1);
    } else if (key === '.') {
      if (!weightText.includes('.')) weightText = (weightText || '0') + '.';
    } else if (weightText.replace('.', '').length < MAX_DIGITS) {
      weightText = weightText === '0' ? key : weightText + key;
    }
    weightConfirmed = false;
    renderWeight();
  });

  toCategoryBtn.addEventListener('click', () => {
    if (getWeight()) showScreen('category');
  });

  // --- 2. 不整脈選択 -------------------------------------------------------
  function renderCategoryButtons() {
    categoryButtonsEl.innerHTML = '';
    ARRHYTHMIA_CATEGORIES.forEach((cat) => {
      const style = CATEGORY_STYLE[cat.id] || {};
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'category-btn';
      btn.dataset.id = cat.id;
      if (style.color) btn.style.setProperty('--cat', style.color);

      const tag = document.createElement('span');
      tag.className = 'category-tag';
      tag.textContent = style.tag || '';
      const name = document.createElement('span');
      name.className = 'category-name';
      name.textContent = cat.shortLabel || cat.label;
      btn.appendChild(tag);
      btn.appendChild(name);

      btn.addEventListener('click', () => {
        selectedCategoryId = cat.id;
        weightConfirmed = false;
        renderConfirm();
        showScreen('confirm');
      });
      categoryButtonsEl.appendChild(btn);
    });
  }

  backToWeightBtn.addEventListener('click', () => showScreen('weight'));

  // --- 3. 体重確認 ---------------------------------------------------------
  function selectedCategory() {
    return ARRHYTHMIA_CATEGORIES.find((c) => c.id === selectedCategoryId) || null;
  }

  function renderConfirm() {
    const cat = selectedCategory();
    confirmCategoryEl.textContent = cat ? cat.label : '';
    confirmWeightEl.textContent = weightDisplay();
  }

  confirmBtn.addEventListener('click', () => {
    if (!getWeight() || !selectedCategory()) return;
    weightConfirmed = true;
    renderResults();
    showScreen('result');
  });
  editWeightBtn.addEventListener('click', () => showScreen('weight'));
  editCategoryBtn.addEventListener('click', () => showScreen('category'));

  // --- 4. 結果 -------------------------------------------------------------
  function renderItemCard(item, weight) {
    const card = document.createElement('div');
    card.className = 'item-card item-kind-' + item.kind;

    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;
    card.appendChild(nameEl);

    if (item.badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = 'item-badge';
      badgeEl.textContent = item.badge;
      card.appendChild(badgeEl);
    }

    if (item.source === 'general_practice') {
      const src = document.createElement('div');
      src.className = 'item-source-note';
      src.textContent = '※ 本ガイドラインに具体的なmg/kg記載が無いため、一般的な小児救急の実務量を暫定的に採用';
      card.appendChild(src);
    }

    // mg/kg・J/kg・μg/kg/分 いずれの投与量も持たない項目（迷走神経刺激手技など）は用量欄を出さない
    const hasDose = item.dosePerKg != null || item.doseMinPerKg != null;
    if (hasDose) {
      const resultEl = document.createElement('div');
      resultEl.className = 'item-result';
      if (weight) {
        const r = calcItem(item, weight);
        if (r.type === 'mg') {
          const isRange = r.doseMgLow !== r.doseMgHigh;
          const doseText = isRange ? fmt(r.doseMgLow) + '〜' + fmt(r.doseMgHigh) + ' mg' : fmt(r.doseMgLow) + ' mg';
          const volText = isRange ? fmt(r.volumeMlLow) + '〜' + fmt(r.volumeMlHigh) + ' mL' : fmt(r.volumeMlLow) + ' mL';
          resultEl.innerHTML =
            '<div class="result-main">' + volText + '</div>' +
            '<div class="result-unit-note">実投与量 ' + doseText + '</div>' +
            (r.cappedByMax ? '<div class="result-flag">成人量を超えるため成人量です（上限 ' + fmt(item.maxDoseMg) + ' mg）</div>' : '') +
            '<div class="standard-dose-note">' + standardDoseText(item) + '</div>' +
            deviationHtml(r);
        } else if (r.type === 'joule') {
          const isRange = r.joulesLow !== r.joulesHigh;
          const jText = isRange ? fmt(r.joulesLow) + '〜' + fmt(r.joulesHigh) + ' J' : fmt(r.joulesLow) + ' J';
          resultEl.innerHTML =
            '<div class="result-main">' + jText + '</div>' +
            '<div class="standard-dose-note">' + standardDoseText(item) + '</div>' +
            deviationHtml(r);
        } else if (r.type === 'infusion') {
          const isRange = r.rateMlHrLow !== r.rateMlHrHigh;
          const rateText = isRange ? fmt(r.rateMlHrLow) + '〜' + fmt(r.rateMlHrHigh) + ' mL/時' : fmt(r.rateMlHrLow) + ' mL/時';
          resultEl.innerHTML =
            '<div class="result-main">' + rateText + '</div>' +
            '<div class="standard-dose-note">' + standardDoseText(item) + '</div>' +
            deviationHtml(r);
        }
      } else {
        resultEl.innerHTML =
          '<div class="result-main result-placeholder">体重を入力すると計算されます</div>' +
          '<div class="standard-dose-note">' + standardDoseText(item) + '</div>';
      }
      card.appendChild(resultEl);
    }

    if (item.stock || item.dilution) {
      const prep = document.createElement('div');
      prep.className = 'item-detail';
      if (item.stock) prep.innerHTML += '<div><b>規格:</b> ' + item.stock + '</div>';
      if (item.dilution) prep.innerHTML += '<div><b>希釈方法:</b> ' + item.dilution + '</div>';
      card.appendChild(prep);
    }

    if (item.route) {
      const routeEl = document.createElement('div');
      routeEl.className = 'item-detail';
      routeEl.innerHTML = '<b>投与方法:</b> ' + item.route;
      card.appendChild(routeEl);
    }

    if (item.escalation) {
      const escEl = document.createElement('div');
      escEl.className = 'item-detail';
      escEl.innerHTML = '<b>増量:</b> ' + item.escalation;
      card.appendChild(escEl);
    }

    if (item.maxDoseNote) {
      const maxEl = document.createElement('div');
      maxEl.className = 'item-detail';
      maxEl.innerHTML = '<b>上限:</b> ' + item.maxDoseNote;
      card.appendChild(maxEl);
    }

    if (item.roundReason) {
      const roundEl = document.createElement('div');
      roundEl.className = 'item-round-note';
      const dirLabel = item.round && item.round.direction === 'up' ? '切り上げ' : '切り下げ';
      roundEl.textContent = '丸め方向: ' + dirLabel + '（' + item.roundReason + '）';
      card.appendChild(roundEl);
    }

    if (item.notes && item.notes.length) {
      const notesEl = document.createElement('ul');
      notesEl.className = 'item-notes';
      item.notes.forEach((n) => {
        const li = document.createElement('li');
        // 文字列のほか { text, warn:true } 形式（重要な禁忌事項を強調したい場合）を許容する
        if (n && typeof n === 'object') {
          li.textContent = n.text;
          if (n.warn) li.className = 'note-warn';
        } else {
          li.textContent = n;
        }
        notesEl.appendChild(li);
      });
      card.appendChild(notesEl);
    }

    return card;
  }

  function renderResults() {
    const cat = selectedCategory();
    if (!cat || !weightConfirmed) return;
    resultTitle.textContent = cat.label;
    resultWeightEl.textContent = weightDisplay() + ' kg';
    const weight = getWeight();
    itemListEl.innerHTML = '';
    cat.items.forEach((item) => {
      itemListEl.appendChild(renderItemCard(item, weight));
    });
  }

  resetBtn.addEventListener('click', () => {
    selectedCategoryId = null;
    weightConfirmed = false;
    showScreen('weight');
  });

  // --- フローチャートモーダル ---------------------------------------------
  function openFlowchartModal() {
    const cat = selectedCategory();
    if (!cat || !cat.flowcharts || !cat.flowcharts.length) return;

    modalTabs.innerHTML = '';
    const showImage = (idx) => {
      const fc = cat.flowcharts[idx];
      modalImageWrap.classList.remove('zoomed');
      modalImage.src = 'assets/flowcharts/' + fc.file;
      modalImage.alt = fc.caption;
      Array.from(modalTabs.children).forEach((t, i) => t.classList.toggle('active', i === idx));

      const sourceKey = fc.sourceKey || 'old2010';
      const sourceInfo = GUIDELINE_SOURCES[sourceKey];

      modalSource.innerHTML = '';
      const citeEl = document.createElement('span');
      citeEl.className = 'modal-source-cite';
      citeEl.textContent = fc.caption + '（' + sourceInfo.title + (fc.page ? ' p.' + fc.page : '') + '） ／ 図をタップで拡大・縮小';
      modalSource.appendChild(citeEl);
      if (fc.page) {
        const linkEl = document.createElement('a');
        linkEl.className = 'modal-source-link';
        linkEl.href = guidelinePdfLink(fc.page, sourceKey);
        linkEl.target = '_blank';
        linkEl.rel = 'noopener';
        linkEl.textContent = sourceInfo.localPath ? '📖 原本PDFの該当ページを開く' : '📖 原本PDF（Web）の該当ページを開く';
        modalSource.appendChild(linkEl);
      }
    };

    if (cat.flowcharts.length > 1) {
      cat.flowcharts.forEach((fc, idx) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'modal-tab';
        tab.textContent = fc.caption;
        tab.addEventListener('click', () => showImage(idx));
        modalTabs.appendChild(tab);
      });
    }
    modal.hidden = false;
    showImage(0);
  }

  function closeModal() {
    modal.hidden = true;
    modalImageWrap.classList.remove('zoomed');
  }

  modalImageWrap.addEventListener('click', () => {
    modalImageWrap.classList.toggle('zoomed');
    modalImageWrap.scrollTop = 0;
    modalImageWrap.scrollLeft = 0;
  });

  flowchartBtn.addEventListener('click', openFlowchartModal);
  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  renderWeight();
  renderCategoryButtons();
  renderFooterSources();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
