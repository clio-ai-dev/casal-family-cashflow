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

// Month index (0-based from Apr 2026) when 59½ is reached: Dec 2038 = month 152
const UNLOCK_MONTH_401K = 152; // (2038-2026)*12 + (12-4) = 152

// Roth Conversion Ladder config
const ROTH_LADDER_ANNUAL = 50000; // Annual conversion from Trad IRA → Roth
const ROTH_LADDER_START_MONTH = 0; // Start converting immediately (Apr 2026)
const ROTH_LADDER_SEASONING = 60;  // 5 years until accessible

const SOURCES = [
  { key: 'academy',      label: "Owner's Comp",        color: '#22c55e', initial: 0,      growth: 0,     maxDraw: Infinity },
  { key: 'beyondsoft',   label: 'Beyondsoft Final',    color: '#14b8a6', initial: 4000,   growth: 0,     maxDraw: 4000 },
  { key: 'hsa',          label: 'HSA Reimbursements',  color: '#3b82f6', initial: 56497,  growth: 0.07,  maxDraw: 50000 },
  { key: 'rothContrib',  label: 'Roth Contributions',  color: '#a855f7', initial: 59790,  growth: 0.07,  maxDraw: Infinity, basisCap: 34500 },
  { key: 'rothRollover', label: 'Roth Rollover Basis', color: '#f97316', initial: 433006, growth: 0.07,  maxDraw: Infinity, basisCap: 134388 },
  { key: 'rothLadder',   label: 'Roth Ladder',         color: '#06b6d4', initial: 0,      growth: 0,     maxDraw: Infinity },
  { key: 'family',       label: 'Family FZROX',        color: '#eab308', initial: 20900,  growth: 0.07,  maxDraw: Infinity },
  { key: 'emergency',    label: 'Emergency Fund',      color: '#ef4444', initial: 60000,  growth: 0.04,  maxDraw: Infinity },
  { key: 'trad401k',     label: 'Pre-Tax 401K (59½)',  color: '#ec4899', initial: 385554, growth: 0.07,  maxDraw: Infinity, unlocksAt: UNLOCK_MONTH_401K }
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

    // 2. Beyondsoft (month 0 only)
    if (m === 0 && remaining > 0) {
      const bDraw = Math.min(bal.beyondsoft, remaining);
      draws.beyondsoft = bDraw;
      bal.beyondsoft -= bDraw;
      remaining -= bDraw;
    }

    // 3-7. Remaining sources (respect unlock dates)
    const drawOrder = ['hsa', 'rothContrib', 'rothRollover', 'rothLadder', 'family', 'trad401k', 'emergency'];
    for (const key of drawOrder) {
      if (remaining <= 0) break;
      const src = SOURCES.find(s => s.key === key);
      // Skip locked sources
      if (src.unlocksAt !== undefined && m < src.unlocksAt) continue;
      let available = bal[key];
      if (key === 'hsa') {
        available = Math.min(available, 50000 - hsaTotalDrawn);
      }
      if (src.basisCap !== undefined && m < UNLOCK_MONTH_401K) {
        available = Math.min(available, Math.max(0, src.basisCap - (cumulativeDraws[key] || 0)));
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
    rows.push({ label, expenses, draws, remaining: Math.max(0, remaining), covered });
    balHistory.push({
      label,
      hsa: bal.hsa,
      rothContrib: bal.rothContrib,
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
  ['hsa', 'rothContrib', 'rothRollover', 'rothLadder', 'family', 'emergency', 'trad401k'].forEach(key => {
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

  // Find month index for 59½ marker
  const unlockIdx = data.rows.findIndex(r => r.label >= '2038-12');

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
            unlockLine: {
              type: 'line',
              xMin: unlockIdx,
              xMax: unlockIdx,
              borderColor: '#ec4899',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½',
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

function renderBalanceChart(data) {
  const labels = data.balHistory.map((_, i) => data.rows[i].label);
  const keys = [
    { key: 'hsa',          label: 'HSA',                color: '#3b82f6' },
    { key: 'rothContrib',  label: 'Roth Contributions', color: '#a855f7' },
    { key: 'rothRollover', label: 'Roth Rollover',      color: '#f97316' },
    { key: 'rothLadder',   label: 'Roth Ladder',        color: '#06b6d4' },
    { key: 'family',       label: 'Family FZROX',       color: '#eab308' },
    { key: 'emergency',    label: 'Emergency Fund',     color: '#ef4444' },
    { key: 'trad401k',     label: 'Pre-Tax 401K',       color: '#ec4899' }
  ];

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
            unlockLine: {
              type: 'line',
              xMin: unlockIdx,
              xMax: unlockIdx,
              borderColor: '#ec4899',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: '59½ — 401K Unlocks',
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
  html += '<th>Beyondsoft</th><th>HSA</th><th>Roth Contrib</th><th>Roth Rollover</th>';
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
  const sourceOrder = [
    { key: 'academy',      label: 'Academy',           color: '#22c55e' },
    { key: 'beyondsoft',   label: 'Beyondsoft',         color: '#14b8a6' },
    { key: 'hsa',          label: 'HSA',                color: '#3b82f6' },
    { key: 'rothContrib',  label: 'Roth Contrib',       color: '#a855f7' },
    { key: 'rothRollover', label: 'Roth Rollover',      color: '#f97316' },
    { key: 'rothLadder',   label: 'Roth Ladder',        color: '#06b6d4' },
    { key: 'family',       label: 'Family FZROX',       color: '#eab308' },
    { key: 'emergency',    label: 'Emergency',          color: '#ef4444' },
    { key: 'trad401k',     label: '401K (59½)',         color: '#ec4899' },
  ];
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
      layout: { padding: { bottom: 45, top: 35 } },
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
    plugins: [{
      id: 'drawOrderLabels',
      afterDraw(chart) {
        const c = chart.ctx;
        c.save();
        c.font = '10px sans-serif';
        c.fillStyle = '#aaa';
        c.strokeStyle = '#555';
        c.lineWidth = 1;
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          const bar = meta.data[0];
          if (!bar || ds.data[0] === 0) return;
          const x = bar.x;
          const above = i % 2 === 1;
          const barTop = bar.y - bar.height / 2;
          const barBot = bar.y + bar.height / 2;
          c.beginPath();
          if (above) {
            c.moveTo(x, barTop);
            c.lineTo(x, barTop - 14);
            c.stroke();
            c.textAlign = 'center';
            c.textBaseline = 'bottom';
            c.fillText(ds.label, x, barTop - 16);
          } else {
            c.moveTo(x, barBot);
            c.lineTo(x, barBot + 14);
            c.stroke();
            c.textAlign = 'center';
            c.textBaseline = 'top';
            c.fillText(ds.label, x, barBot + 16);
          }
        });
        c.restore();
      }
    }]
  });
}

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
