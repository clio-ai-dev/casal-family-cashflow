const SCENARIOS = {
  pessimistic: { label: 'Pessimistic', grossMo: 6000, compRate: 0.65 },
  realistic:   { label: 'Realistic',   grossMo: 12000, compRate: 0.65 }
};

const EXPENSES_MO = 8269;
const EXPENSES_APR = 8048; // COBRA month
const MONTHS = 120;
const START_YEAR = 2026;
const START_MONTH = 4; // April

const SOURCES = [
  { key: 'academy',      label: 'Academy Comp',       color: '#22c55e', initial: 0,      growth: 0,     maxDraw: Infinity },
  { key: 'beyondsoft',   label: 'Beyondsoft Final',    color: '#14b8a6', initial: 4000,   growth: 0,     maxDraw: 4000 },
  { key: 'hsa',          label: 'HSA Reimbursements',  color: '#3b82f6', initial: 56497,  growth: 0.07,  maxDraw: 50000 },
  { key: 'rothContrib',  label: 'Roth Contributions',  color: '#a855f7', initial: 34500,  growth: 0.07,  maxDraw: Infinity },
  { key: 'rothRollover', label: 'Roth Rollover Basis', color: '#f97316', initial: 343000, growth: 0.07,  maxDraw: Infinity },
  { key: 'family',       label: 'Family FZROX',        color: '#eab308', initial: 20900,  growth: 0.07,  maxDraw: Infinity },
  { key: 'emergency',    label: 'Emergency Fund',      color: '#ef4444', initial: 60000,  growth: 0.04,  maxDraw: Infinity }
];

let currentScenario = 'pessimistic';
let sourceChart, balanceChart;

function simulate(scenarioKey) {
  const sc = SCENARIOS[scenarioKey];
  const compMo = sc.grossMo * sc.compRate;

  // Initialize balances
  const bal = {};
  SOURCES.forEach(s => { bal[s.key] = s.initial; });
  let hsaTotalDrawn = 0;

  const rows = [];
  const balHistory = [];

  for (let m = 0; m < MONTHS; m++) {
    const yr = START_YEAR + Math.floor((START_MONTH - 1 + m) / 12);
    const mo = ((START_MONTH - 1 + m) % 12) + 1;
    const label = `${yr}-${String(mo).padStart(2, '0')}`;
    const expenses = (m === 0) ? EXPENSES_APR : EXPENSES_MO;

    // Grow invested balances (beginning of month)
    SOURCES.forEach(s => {
      if (s.growth > 0 && s.key !== 'academy' && s.key !== 'beyondsoft') {
        bal[s.key] *= (1 + s.growth / 12);
      }
    });

    // Fill expenses from sources in order
    let remaining = expenses;
    const draws = {};
    SOURCES.forEach(s => { draws[s.key] = 0; });

    // 1. Academy comp
    const academyDraw = Math.min(compMo, remaining);
    draws.academy = academyDraw;
    remaining -= academyDraw;

    // 2. Beyondsoft (month 0 only)
    if (m === 0 && remaining > 0) {
      const bDraw = Math.min(bal.beyondsoft, remaining);
      draws.beyondsoft = bDraw;
      bal.beyondsoft -= bDraw;
      remaining -= bDraw;
    }

    // 3-7. Remaining sources
    const drawOrder = ['hsa', 'rothContrib', 'rothRollover', 'family', 'emergency'];
    for (const key of drawOrder) {
      if (remaining <= 0) break;
      let available = bal[key];
      if (key === 'hsa') {
        available = Math.min(available, 50000 - hsaTotalDrawn);
      }
      const draw = Math.min(available, remaining);
      if (draw > 0) {
        draws[key] = draw;
        bal[key] -= draw;
        if (key === 'hsa') hsaTotalDrawn += draw;
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
      family: bal.family,
      emergency: bal.emergency,
      hsaDrawn: hsaTotalDrawn
    });
  }

  // Find when money runs out
  const lastCovered = rows.findLastIndex(r => r.covered);
  const runwayMonths = lastCovered + 1;

  // Find depletion months for each source
  const depletions = {};
  ['hsa', 'rothContrib', 'rothRollover', 'family', 'emergency'].forEach(key => {
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
    <div class="card"><div class="label">Academy Comp</div><div class="value green">$${data.compMo.toLocaleString()}</div></div>
    <div class="card"><div class="label">Monthly Gap</div><div class="value ${surplus ? 'green' : 'orange'}">$${Math.abs(gap).toLocaleString()}${surplus ? ' surplus' : ''}</div></div>
    <div class="card"><div class="label">Total Runway</div><div class="value ${data.runwayMonths >= 120 ? 'green' : data.runwayMonths >= 60 ? 'orange' : 'red'}">${data.runwayMonths >= 120 ? '10+ years' : yrs + ' years'}</div>
      <div class="detail">${data.runwayMonths >= 120 ? 'Indefinite at this rate' : data.runwayMonths + ' months'}</div></div>
    <div class="card"><div class="label">HSA Depleted</div><div class="value" style="font-size:1.1rem">${data.depletions.hsa}</div></div>
    <div class="card"><div class="label">Roth Contrib Depleted</div><div class="value" style="font-size:1.1rem">${data.depletions.rothContrib}</div></div>
    <div class="card"><div class="label">Roth Rollover Depleted</div><div class="value" style="font-size:1.1rem">${data.depletions.rothRollover}</div></div>
    <div class="card"><div class="label">Emergency Depleted</div><div class="value" style="font-size:1.1rem">${data.depletions.emergency}</div></div>
  `;
}

function renderSourceChart(data) {
  const labels = data.rows.map(r => r.label);
  const datasets = SOURCES.map(s => ({
    label: s.label,
    data: data.rows.map(r => Math.round(r.draws[s.key])),
    backgroundColor: s.color,
    borderWidth: 0
  }));

  const ctx = document.getElementById('sourceChart').getContext('2d');
  if (sourceChart) sourceChart.destroy();
  sourceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#aaa', usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: '#666',
            maxTicksLimit: 24,
            callback: function(val, idx) { return idx % 6 === 0 ? this.getLabelForValue(val) : ''; }
          },
          grid: { color: '#1f222c' }
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
    { key: 'hsa',          label: 'HSA',               color: '#3b82f6' },
    { key: 'rothContrib',  label: 'Roth Contributions', color: '#a855f7' },
    { key: 'rothRollover', label: 'Roth Rollover',      color: '#f97316' },
    { key: 'family',       label: 'Family FZROX',       color: '#eab308' },
    { key: 'emergency',    label: 'Emergency Fund',     color: '#ef4444' }
  ];

  const datasets = keys.map(k => ({
    label: k.label,
    data: data.balHistory.map(b => Math.round(b[k.key])),
    borderColor: k.color,
    backgroundColor: k.color + '20',
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 2
  }));

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
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#666',
            maxTicksLimit: 24,
            callback: function(val, idx) { return idx % 6 === 0 ? this.getLabelForValue(val) : ''; }
          },
          grid: { color: '#1f222c' }
        },
        y: {
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
  html += '<th>Family</th><th>Emergency</th><th>Gap</th></tr></thead><tbody>';

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
  renderSourceChart(data);
  renderBalanceChart(data);
  renderTable(data);
}

// Initial render
setScenario('pessimistic');
