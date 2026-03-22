const SCENARIOS = {
  pessimistic: { label: 'Pessimistic', grossMo: 6000,  compRate: 0.65 },
  mid:         { label: 'Mid',         grossMo: 10000, compRate: 0.65 },
  optimistic:  { label: 'Optimistic',  grossMo: 15000, compRate: 0.65 }
};

const EXPENSES_MO = 8269;
const EXPENSES_APR = 8048; // COBRA month
const INFLATION_ANNUAL = 0.03;
const BF_MULTIPLIER = 2.0; // Black Friday bump applied to December gross
const MONTHS_DEFAULT = 120;
const START_YEAR = 2026;
const START_MONTH = 4; // April

function getMonths() {
  const el = document.getElementById('end-year');
  if (!el) return MONTHS_DEFAULT;
  const endYear = parseInt(el.value) || (START_YEAR + 10);
  return Math.max(12, (endYear - START_YEAR) * 12 - (START_MONTH - 1));
}

// Month index (0-based from Apr 2026) when 59½ is reached
const UNLOCK_MONTH_401K = 152; // Julio: Dec 2038 = (2038-2026)*12 + (12-4) = 152
const UNLOCK_MONTH_YESSENIA = 144; // Yessenia: Apr 2038 = (2038-2026)*12 + (4-4) = 144

// Roth Conversion Ladder config
const ROTH_LADDER_ANNUAL = 50000; // Annual conversion from Trad IRA → Roth
const ROTH_LADDER_START_MONTH = 0; // Start converting immediately (Apr 2026)
const ROTH_LADDER_SEASONING = 60;  // 5 years until accessible

// Social Security
const SS_START_MONTH = (2046 - START_YEAR) * 12 + (10 - START_MONTH); // Oct 2046 = Julio turns 67 (FRA)
const SS_MONTHLY = 2631; // SSA statement Mar 2026 (at FRA 67) // Conservative estimate based on earnings history

const SOURCES = [
  { key: 'academy',      label: "Owner's Comp",        color: '#22c55e', initial: 0,      growth: 0,     maxDraw: Infinity },
  { key: 'beyondsoft',   label: 'Beyondsoft Final',    color: '#14b8a6', initial: 4000,   growth: 0,     maxDraw: 4000 },
  { key: 'hsa',          label: 'HSA Reimbursements',  color: '#3b82f6', initial: 56497,  growth: 0.07,  maxDraw: 50000 },
  { key: 'rothContrib',  label: "Julio's Roth IRA",  color: '#a855f7', initial: 66790,  growth: 0.07,  maxDraw: Infinity, basisCap: 41500 },
  { key: 'yesseniaRoth', label: "Yessenia's Roth IRA", color: '#d946ef', initial: 61149,  growth: 0.07,  maxDraw: Infinity, basisCap: 37502, basisUnlock: UNLOCK_MONTH_YESSENIA },
  { key: 'rothRollover', label: 'Roth Rollover Basis', color: '#f97316', initial: 433006, growth: 0.07,  maxDraw: Infinity, basisCap: 134388 },
  { key: 'rothLadder',   label: 'Roth Ladder',         color: '#06b6d4', initial: 0,      growth: 0,     maxDraw: Infinity },
  { key: 'family',       label: 'Family Taxable',        color: '#eab308', initial: 133305,  growth: 0.07,  maxDraw: Infinity },
  { key: 'emergency',    label: 'Emergency Fund',      color: '#ef4444', initial: 60000,  growth: 0.04,  maxDraw: Infinity },
  { key: 'trad401k',     label: 'Pre-Tax 401K (59½)',  color: '#ec4899', initial: 385554, growth: 0.07,  maxDraw: Infinity, unlocksAt: UNLOCK_MONTH_401K },
  { key: 'solo401k',     label: 'Solo 401K (59½)',     color: '#fb7185', initial: 24665,  growth: 0.07,  maxDraw: Infinity, unlocksAt: UNLOCK_MONTH_401K }
];

let currentScenario = 'pessimistic';
let sourceChart, balanceChart;

function simulate(scenarioKey) {
  const sc = SCENARIOS[scenarioKey];
  const MONTHS = getMonths();
  const compMo = sc.grossMo * sc.compRate;

  // Initialize balances
  const bal = {};
  SOURCES.forEach(s => { bal[s.key] = s.initial; });
  let hsaTotalDrawn = 0;
  const cumulativeDraws = {};

  // Track Roth ladder conversions: array of { month, amount }
  const ladderConversions = [];

  const rows = [];
  const balHistory = [];

  for (let m = 0; m < MONTHS; m++) {
    const yr = START_YEAR + Math.floor((START_MONTH - 1 + m) / 12);
    const mo = ((START_MONTH - 1 + m) % 12) + 1;
    const label = `${yr}-${String(mo).padStart(2, '0')}`;
    const expenses = (m === 0 ? EXPENSES_APR : EXPENSES_MO) * Math.pow(1 + INFLATION_ANNUAL / 12, m);

    // Grow invested balances (beginning of month)
    SOURCES.forEach(s => {
      if (s.growth > 0 && s.key !== 'academy' && s.key !== 'beyondsoft') {
        bal[s.key] *= (1 + s.growth / 12);
      }
    });

    // Roth conversion ladder: convert annually (every 12 months) from trad401k, stop at 59½
    if (m >= ROTH_LADDER_START_MONTH && m < UNLOCK_MONTH_401K && m % 12 === 0 && bal.trad401k > 0) {
      const convertAmt = Math.min(ROTH_LADDER_ANNUAL, bal.trad401k);
      bal.trad401k -= convertAmt;
      ladderConversions.push({ month: m, amount: convertAmt });
    }

    // Grow unseasoned ladder conversions (they're invested in Roth IRA)
    ladderConversions.forEach(c => {
      if (m > c.month && m <= c.month + ROTH_LADDER_SEASONING) {
        c.amount *= (1 + 0.07 / 12);
      }
    });

    // Credit seasoned ladder conversions to rothLadder balance
    ladderConversions.forEach(c => {
      if (m === c.month + ROTH_LADDER_SEASONING && c.amount > 0) {
        bal.rothLadder += c.amount;
      }
    });

    // Fill expenses from sources in order
    let remaining = expenses;
    const draws = {};
    SOURCES.forEach(s => { draws[s.key] = 0; });

    // 1. Academy comp (December gets Black Friday multiplier)
    const effectiveComp = (mo === 12) ? sc.grossMo * BF_MULTIPLIER * sc.compRate : compMo;
    const academyDraw = Math.min(effectiveComp, remaining);
    draws.academy = academyDraw;
    remaining -= academyDraw;

    // 2. Social Security (starting at FRA age 67)
    let ssDraw = 0;
    if (m >= SS_START_MONTH && remaining > 0) {
      ssDraw = Math.min(SS_MONTHLY, remaining);
      remaining -= ssDraw;
    }

    // 3. Beyondsoft (month 0 only)
    if (m === 0 && remaining > 0) {
      const bDraw = Math.min(bal.beyondsoft, remaining);
      draws.beyondsoft = bDraw;
      bal.beyondsoft -= bDraw;
      remaining -= bDraw;
    }

    // 3-7. Remaining sources (respect unlock dates)
    const drawOrder = ['hsa', 'rothContrib', 'yesseniaRoth', 'rothRollover', 'rothLadder', 'family', 'trad401k', 'solo401k', 'emergency'];
    for (const key of drawOrder) {
      if (remaining <= 0) break;
      const src = SOURCES.find(s => s.key === key);
      // Skip locked sources
      if (src.unlocksAt !== undefined && m < src.unlocksAt) continue;
      let available = bal[key];
      if (key === 'hsa') {
        available = Math.min(available, 50000 - hsaTotalDrawn);
      }
      if (src.basisCap !== undefined) {
        const basisUnlockMonth = src.basisUnlock !== undefined ? src.basisUnlock : UNLOCK_MONTH_401K;
        if (m < basisUnlockMonth) {
          available = Math.min(available, Math.max(0, src.basisCap - (cumulativeDraws[key] || 0)));
        }
      }
      const draw = Math.min(available, remaining);
      if (draw > 0) {
        draws[key] = draw;
        bal[key] -= draw;
        if (key === 'hsa') hsaTotalDrawn += draw;
        cumulativeDraws[key] = (cumulativeDraws[key] || 0) + draw;
        remaining -= draw;
      }
    }

    const covered = remaining <= 0;
    draws.socialSecurity = ssDraw;
    rows.push({ label, expenses, draws, remaining: Math.max(0, remaining), covered });
    balHistory.push({
      label,
      hsa: bal.hsa,
      rothContrib: bal.rothContrib,
      yesseniaRoth: bal.yesseniaRoth,
      rothRollover: bal.rothRollover,
      rothLadder: bal.rothLadder,
      family: bal.family,
      emergency: bal.emergency,
      trad401k: bal.trad401k,
      hsaDrawn: hsaTotalDrawn
    });
  }

  // Find when money runs out
  const lastCovered = rows.findLastIndex(r => r.covered);
  const runwayMonths = lastCovered + 1;

  // Find depletion months for each source
  const depletions = {};
  ['hsa', 'rothContrib', 'yesseniaRoth', 'rothRollover', 'rothLadder', 'family', 'emergency', 'trad401k'].forEach(key => {
    const idx = rows.findIndex(r => {
      if (key === 'hsa') return balHistory[rows.indexOf(r)].hsaDrawn >= 50000;
      return balHistory[rows.indexOf(r)][key] < 1;
    });
    depletions[key] = idx >= 0 ? rows[idx].label : 'Never';
  });

  return { rows, balHistory, runwayMonths, depletions, compMo, expenses: EXPENSES_MO };
}

function renderSummary(data) {
  const yrs = (data.runwayMonths / 12).toFixed(1);
  const gap = data.expenses - data.compMo;
  const surplus = gap <= 0;
  const cards = document.getElementById('summary-cards');
  cards.innerHTML = `
    <div class="card"><div class="label">Monthly Expenses</div><div class="value">$${data.expenses.toLocaleString()}</div></div>
    <div class="card"><div class="label">Owner's Comp (${Math.round(SCENARIOS[currentScenario].compRate * 100)}%)</div><div class="value green">$${data.compMo.toLocaleString()}</div><div class="detail">${Math.round(SCENARIOS[currentScenario].compRate * 100)}% of $${SCENARIOS[currentScenario].grossMo.toLocaleString()}/mo gross</div></div>
    <div class="card"><div class="label">Monthly Gap</div><div class="value ${surplus ? 'green' : 'orange'}">$${Math.abs(gap).toLocaleString()}${surplus ? ' surplus' : ''}</div></div>
    <div class="card"><div class="label">Total Runway</div><div class="value ${data.runwayMonths >= 120 ? 'green' : data.runwayMonths >= 60 ? 'orange' : 'red'}">${data.runwayMonths >= 120 ? '10+ years' : yrs + ' years'}</div>
      <div class="detail">${data.runwayMonths >= 120 ? 'Indefinite at this rate' : data.runwayMonths + ' months'}</div></div>
    <div class="card"><div class="label">Inflation Rate</div><div class="value" style="font-size:1.1rem">${(INFLATION_ANNUAL * 100).toFixed(0)}%/yr</div></div>
  `;
}

function renderSourceChart(data) {
  const labels = data.rows.map(r => r.label);
  const datasets = SOURCES.map(s => ({
    label: s.label,
    data: data.rows.map(r => r.draws[s.key]),
    backgroundColor: s.color,
    borderWidth: 0
  }));

  // Add Social Security dataset
  datasets.splice(1, 0, {
    label: 'Social Security',
    data: data.rows.map(r => r.draws.socialSecurity || 0),
    backgroundColor: '#8b5cf6',
    borderWidth: 0
  });

  // Find month index for 59½ marker
  const unlockIdx = data.rows.findIndex(r => r.label >= '2038-12');
  const unlockIdxY = data.rows.findIndex(r => r.label >= '2038-04');

  const ctx = document.getElementById('sourceChart').getContext('2d');
  if (sourceChart) sourceChart.destroy();
  sourceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toLocaleString()}`
          }
        },
        annotation: {
          annotations: {
            unlockLineY: {
              type: 'line',
              xMin: unlockIdxY,
              xMax: unlockIdxY,
              borderColor: '#d946ef',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½ (Y)',
                position: 'start',
                backgroundColor: '#d946ef80',
                color: '#fff',
                font: { size: 11 }
              }
            },
            unlockLine: {
              type: 'line',
              xMin: unlockIdx,
              xMax: unlockIdx,
              borderColor: '#ec4899',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½ (J)',
                position: 'start',
                backgroundColor: '#ec489980',
                color: '#fff',
                font: { size: 11 }
              }
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: '#666',
            maxTicksLimit: 20,
            callback: function(val, idx) { return idx % 12 === 0 ? this.getLabelForValue(val) : ''; }
          },
          grid: { color: '#1f222c', display: false }
        },
        y: {
          stacked: true,
          ticks: { color: '#666', callback: v => '$' + (v/1000).toFixed(0) + 'K' },
          grid: { color: '#1f222c' }
        }
      }
    }
  });

  // Build source legend (2-column grid, same as draw order)
  const srcDescs = {
    academy:      "Academy take-home (65% of gross). 2x in December for Black Friday.",
    socialSecurity: "Estimated $2,631/mo starting age 67 (Oct 2046).",
    beyondsoft:   "Final paycheck, April 2026 only.",
    hsa:          "$50K max draws, grows at 7%.",
    rothContrib:  "$41.5K basis pre-59½, full balance after.",
    yesseniaRoth: "$37.5K basis pre-59½ (Apr 2038), full balance after.",
    rothRollover: "$134K basis pre-59½, full balance after.",
    rothLadder:   "$50K/yr conversions, 5-year seasoning, grows while waiting.",
    family:       "FZROX + MSFT stock. Taxable brokerage, fully accessible.",
    emergency:    "Cash at ~4%. Last resort.",
    trad401k:     "Locked until 59½. Feeds Roth ladder.",
    solo401k:     "Self-employed 401K. Locked until 59½.",
  };
  const srcLegend = document.getElementById('sourceLegend');
  if (srcLegend) {
    const items = SOURCES.filter(s => srcDescs[s.key]);
    // Insert Social Security after academy
    const ssItem = { key: 'socialSecurity', label: 'Social Security', color: '#8b5cf6' };
    const acIdx = items.findIndex(s => s.key === 'academy');
    items.splice(acIdx + 1, 0, ssItem);
    const half = Math.ceil(items.length / 2);
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px">';
    for (let i = 0; i < half; i++) {
      const l = items[i];
      if (l) html += `<div class="legend-item"><span class="dot" style="background:${l.color}"></span><strong>${l.label}</strong> — ${srcDescs[l.key]}</div>`;
      else html += '<div></div>';
      const r = items[half + i];
      if (r) html += `<div class="legend-item"><span class="dot" style="background:${r.color}"></span><strong>${r.label}</strong> — ${srcDescs[r.key]}</div>`;
      else html += '<div></div>';
    }
    html += '</div>';
    srcLegend.innerHTML = html;
  }
}

function renderBalanceChart(data) {
  const labels = data.balHistory.map((_, i) => data.rows[i].label);
  const balKeys = ['hsa','rothContrib','yesseniaRoth','rothRollover','rothLadder','family','emergency','trad401k','solo401k'];
  const keys = balKeys.map(k => SOURCES.find(s => s.key === k)).filter(Boolean);

  // Stacked area datasets
  const datasets = keys.map(k => ({
    label: k.label,
    data: data.balHistory.map(b => Math.round(b[k.key])),
    borderColor: k.color,
    backgroundColor: k.color + '80',
    fill: true,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 1
  }));

  // Expenses line (inflation-adjusted monthly expense * 12 for visibility, or just monthly)
  datasets.push({
    label: 'Monthly Expenses (inflation-adj)',
    data: data.rows.map(r => Math.round(r.expenses)),
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 2,
    borderDash: [6, 4]
  });

  const unlockIdx = labels.indexOf('2038-12');
  const unlockIdxY = labels.indexOf('2038-04');

  const ctx = document.getElementById('balanceChart').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#aaa', usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toLocaleString()}`
          }
        },
        annotation: {
          annotations: {
            unlockLineY: {
              type: 'line',
              xMin: unlockIdxY,
              xMax: unlockIdxY,
              borderColor: '#d946ef',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½ (Y)',
                position: 'start',
                backgroundColor: '#d946ef80',
                color: '#fff',
                font: { size: 11 }
              }
            },
            unlockLine: {
              type: 'line',
              xMin: unlockIdx,
              xMax: unlockIdx,
              borderColor: '#ec4899',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½ (J)',
                position: 'start',
                backgroundColor: '#ec489980',
                color: '#fff',
                font: { size: 11 }
              }
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: '#666',
            maxTicksLimit: 20,
            callback: function(val, idx) { return idx % 12 === 0 ? this.getLabelForValue(val) : ''; }
          },
          grid: { color: '#1f222c', display: false }
        },
        y: {
          stacked: true,
          ticks: { color: '#666', callback: v => '$' + (v/1000).toFixed(0) + 'K' },
          grid: { color: '#1f222c' }
        }
      }
    }
  });
}

function renderTable(data) {
  const srcKeys = SOURCES.map(s => s.key);
  let html = '<table><thead><tr><th>Period</th><th>Expenses</th><th>Academy</th>';
  html += '<th>Beyondsoft</th><th>HSA</th><th>Julio\'s Roth</th><th>Roth Rollover</th>';
  html += '<th>Roth Ladder</th><th>Family</th><th>Emergency</th><th>Pre-Tax 401K</th><th>Gap</th></tr></thead><tbody>';

  data.rows.forEach((r, i) => {
    // Show monthly for first 24, then quarterly
    if (i >= 24 && i % 3 !== 0) return;
    const cls = k => r.draws[k] > 0 ? `src-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}` : 'depleted';
    const fmt = v => v > 0 ? '$' + Math.round(v).toLocaleString() : '—';
    html += `<tr><td>${r.label}</td><td>$${r.expenses.toLocaleString()}</td>`;
    srcKeys.forEach(k => {
      html += `<td class="${cls(k)}">${fmt(r.draws[k])}</td>`;
    });
    html += `<td class="${r.remaining > 0 ? 'src-emergency' : ''}">${r.remaining > 0 ? '-$' + Math.round(r.remaining).toLocaleString() : '✅'}</td></tr>`;
  });

  html += '</tbody></table>';
  document.getElementById('table-wrapper').innerHTML = html;
}

function setScenario(key) {
  currentScenario = key;
  document.querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + key).classList.add('active');
  const data = simulate(key);
  renderSummary(data);
  renderDrawOrder(data);
  renderSourceChart(data);
  if (document.getElementById('balanceChart')) renderBalanceChart(data);
  renderTable(data);
}

// Draw order stacked bar chart — single horizontal bar, sized by total lifetime draws
let drawOrderChart = null;
function renderDrawOrder(data) {
  const ctx = document.getElementById('drawOrderChart');
  if (!ctx) return;
  if (drawOrderChart) drawOrderChart.destroy();

  // Sum total draws per source across all months
  const sourceOrder = [...SOURCES];
  // Insert Social Security after academy
  const ssSource = { key: 'socialSecurity', label: 'Social Security', color: '#8b5cf6' };
  const acOrdIdx = sourceOrder.findIndex(s => s.key === 'academy');
  sourceOrder.splice(acOrdIdx + 1, 0, ssSource);
  const totals = {};
  sourceOrder.forEach(s => { totals[s.key] = 0; });
  data.rows.forEach(r => {
    sourceOrder.forEach(s => { totals[s.key] += (r.draws[s.key] || 0); });
  });

  drawOrderChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [''],
      datasets: sourceOrder.map(s => ({
        label: s.label,
        data: [Math.round(totals[s.key])],
        backgroundColor: s.color,
        borderWidth: 0
      }))
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 5, bottom: 5 } },
      scales: {
        x: { display: false, stacked: true },
        y: { display: false, stacked: true }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => 'Draw Order (left → right)',
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toLocaleString()}`
          }
        }
      }
    },
    plugins: []
  });

  // Build HTML legend with descriptions matching Monthly Income Sources
  const sourceDescs = {
    academy:      "Academy take-home (65% of gross). 2x in December for Black Friday.",
    socialSecurity: "Estimated $2,631/mo starting age 67 (Oct 2046).",
    beyondsoft:   "Final paycheck, April 2026 only.",
    hsa:          "$50K max draws, grows at 7%.",
    rothContrib:  "$41.5K basis pre-59½, full balance after.",
    yesseniaRoth: "$37.5K basis pre-59½ (Apr 2038), full balance after.",
    rothRollover: "$134K basis pre-59½, full balance after.",
    rothLadder:   "$50K/yr conversions, 5-year seasoning, grows while waiting.",
    family:       "FZROX + MSFT stock. Taxable brokerage, fully accessible.",
    emergency:    "Cash at ~4%. Last resort.",
    trad401k:     "Locked until 59½. Feeds Roth ladder.",
    solo401k:     "Self-employed 401K. Locked until 59½.",
  };
  const legend = document.getElementById('drawOrderLegend');
  if (legend) {
    const items = sourceOrder.filter(s => totals[s.key] > 0);
    const half = Math.ceil(items.length / 2);
    const leftItems = items.slice(0, half);
    const rightItems = items.slice(half);
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px">';
    for (let i = 0; i < half; i++) {
      const l = leftItems[i];
      if (l) html += `<div class="legend-item"><span class="dot" style="background:${l.color}"></span><strong>${l.label}</strong> — ${sourceDescs[l.key]}</div>`;
      else html += '<div></div>';
      const r = rightItems[i];
      if (r) html += `<div class="legend-item"><span class="dot" style="background:${r.color}"></span><strong>${r.label}</strong> — ${sourceDescs[r.key]}</div>`;
      else html += '<div></div>';
    }
    html += '</div>';
    legend.innerHTML = html;
  }
}

// Asset Map — visual bucket diagram
(function renderAssetMap() {
  const el = document.getElementById('assetMap');
  if (!el) return;

  const buckets = [
    { label: '.NET Academy', sub: '$6K/mo pessimistic', amount: '', color: '#22c55e', height: 80, type: 'income' },
    { label: 'HSA', sub: '$50K max draws', amount: '$56K', color: '#3b82f6', height: 70 },
    { label: "Julio's Roth IRA", sub: '$41.5K basis', amount: '$67K', color: '#a855f7', height: 75 },
    { label: "Yessenia's Roth IRA", sub: '$37.5K basis', amount: '$61K', color: '#d946ef', height: 72 },
    { label: "Julio's Trad IRA", sub: '$50K/yr → Roth', amount: '$0→$386K', color: '#9ca3af', height: 60, type: 'passthrough' },
    { label: 'MSFT 401K', sub: '', amount: '', color: '#000', height: 180, type: 'compound',
      parts: [
        { label: 'Pre-Tax', amount: '$386K', color: '#ec4899', height: 70 },
        { label: 'Roth Growth', amount: '$300K', color: '#f97316', height: 60 },
        { label: 'Roth Contrib', amount: '$135K', color: '#f97316', height: 50 },
      ]
    },
    { label: 'Family Taxable', sub: 'FZROX + MSFT', amount: '$133K', color: '#eab308', height: 110 },
    { label: 'Emergency Fund', sub: 'Last resort', amount: '$60K', color: '#ef4444', height: 70 },
    { label: 'Solo 401K', sub: 'Locked until 59½', amount: '$25K', color: '#fb7185', height: 50 },
    { label: '529 Plans', sub: '3 kids', amount: '$68K', color: '#06b6d4', height: 75 },
  ];

  const bw = 100, gap = 14, pad = 20;
  const totalW = buckets.length * (bw + gap) - gap + pad * 2;
  const svgH = 340;
  const baseY = 280;

  let svg = `<svg viewBox="0 0 ${totalW} ${svgH}" style="width:100%;max-width:${totalW}px;height:auto;font-family:system-ui,sans-serif">`;
  svg += `<defs><filter id="ds"><feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.3"/></filter></defs>`;

  let x = pad;
  buckets.forEach((b, i) => {
    if (b.type === 'compound') {
      // Stacked compound bucket (MSFT 401K)
      let totalH = b.parts.reduce((s, p) => s + p.height, 0);
      let y = baseY - totalH;
      // Outer border
      svg += `<rect x="${x-2}" y="${y-2}" width="${bw+4}" height="${totalH+4}" rx="6" fill="none" stroke="#555" stroke-width="1.5"/>`;
      let py = y;
      b.parts.forEach(p => {
        svg += `<rect x="${x}" y="${py}" width="${bw}" height="${p.height}" rx="4" fill="${p.color}22" stroke="${p.color}" stroke-width="1.5" filter="url(#ds)"/>`;
        svg += `<text x="${x + bw/2}" y="${py + p.height/2 - 6}" text-anchor="middle" fill="${p.color}" font-size="10" font-weight="bold">${p.amount}</text>`;
        svg += `<text x="${x + bw/2}" y="${py + p.height/2 + 8}" text-anchor="middle" fill="#ccc" font-size="9">${p.label}</text>`;
        py += p.height;
      });
      svg += `<text x="${x + bw/2}" y="${baseY + 16}" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">${b.label}</text>`;
    } else {
      let h = b.height;
      let y = baseY - h;
      let fill = b.type === 'passthrough' ? `${b.color}11` : `${b.color}22`;
      let stroke = b.type === 'passthrough' ? '#666' : b.color;
      let dash = b.type === 'passthrough' ? ' stroke-dasharray="6,3"' : '';
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash} filter="url(#ds)"/>`;
      if (b.type === 'income') {
        svg += `<text x="${x + bw/2}" y="${y + h/2 - 6}" text-anchor="middle" fill="${b.color}" font-size="11" font-weight="bold">${b.label}</text>`;
        svg += `<text x="${x + bw/2}" y="${y + h/2 + 10}" text-anchor="middle" fill="#aaa" font-size="9">${b.sub}</text>`;
      } else {
        svg += `<text x="${x + bw/2}" y="${y + h/2 - 10}" text-anchor="middle" fill="${b.color}" font-size="13" font-weight="bold">${b.amount}</text>`;
        if (b.sub) svg += `<text x="${x + bw/2}" y="${y + h/2 + 6}" text-anchor="middle" fill="#aaa" font-size="8.5">${b.sub}</text>`;
      }
      svg += `<text x="${x + bw/2}" y="${baseY + 16}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">${b.label}</text>`;
      if (b.sub && b.type !== 'income') {
        // label already in rect
      }
    }
    x += bw + gap;
  });

  // Flow arrow: Trad IRA → Roth ladder (bucket 4 to bucket 2)
  const tradX = pad + 4 * (bw + gap) + bw/2;
  const tradY = baseY - 60;
  const julioRothX = pad + 2 * (bw + gap) + bw/2;
  const julioRothY = baseY - 75 - 10;
  svg += `<defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#9ca3af"/></marker></defs>`;
  svg += `<path d="M${tradX},${tradY - 15} C${tradX - 30},${tradY - 60} ${julioRothX + 40},${julioRothY - 30} ${julioRothX + 10},${julioRothY}" stroke="#9ca3af" stroke-width="1.5" fill="none" stroke-dasharray="5,3" marker-end="url(#arrowhead)"/>`;
  svg += `<text x="${(tradX + julioRothX)/2}" y="${tradY - 50}" text-anchor="middle" fill="#9ca3af" font-size="9">$50K/yr</text>`;

  // Flow arrow: MSFT Pre-Tax → Trad IRA
  const msftX = pad + 5 * (bw + gap) + bw/2;
  const msftY = baseY - 180;
  svg += `<path d="M${msftX - bw/2 - 5},${msftY + 35} L${tradX + bw/2 + 5},${tradY - 10}" stroke="#ec4899" stroke-width="1.5" fill="none" stroke-dasharray="5,3" marker-end="url(#arrowhead)"/>`;
  svg += `<text x="${(msftX + tradX)/2 - 10}" y="${(msftY + tradY)/2 - 5}" text-anchor="middle" fill="#ec4899" font-size="9">rollover</text>`;

  svg += '</svg>';
  el.innerHTML = svg;
})();

// Expense breakdown pie chart
(function renderExpensePie() {
  const ctx = document.getElementById('expenseChart');
  if (!ctx) return;
  const categories = [
    { label: 'Groceries & Gas',     value: 1595, color: '#22c55e' },
    { label: 'Fixed Bills',          value: 954,  color: '#3b82f6' },
    { label: 'Subscriptions & Edu',  value: 540,  color: '#8b5cf6' },
    { label: 'Dining & Misc',        value: 729,  color: '#f59e0b' },
    { label: 'ACA Health + Dental',   value: 2221, color: '#ef4444' },
    { label: 'Sinking Fund',         value: 1070, color: '#eab308' },
    { label: 'Yessenia Allowance',    value: 500,  color: '#a855f7' },
    { label: '529 Contributions',     value: 460,  color: '#06b6d4' },
    { label: 'Clothing & Gifts',     value: 200,  color: '#f97316' },
  ];
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.label),
      datasets: [{
        data: categories.map(c => c.value),
        backgroundColor: categories.map(c => c.color),
        borderColor: '#0d0f13',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { color: '#ccc', padding: 12, font: { size: 13 }, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const v = ctx.raw;
              const total = ctx.chart.data.datasets[0].data.reduce((a,b) => a+b, 0);
              const pct = ((v / total) * 100).toFixed(1);
              return ` $${v.toLocaleString()}/mo (${pct}%)`;
            }
          }
        }
      }
    }
  });
})();

// Initial render
setScenario('pessimistic');
