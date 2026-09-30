/**
 * Arena Audit — Interactive Standalone Visual Dashboard Generator
 * Generates a self-contained, responsive, zero-dependency HTML application.
 */

export function generateDashboardHtml(data) {
  const {
    project = 'Project',
    timestamp = new Date().toISOString(),
    score = 85,
    gates = [],
    lenses = [],
    findings = [],
    priorities = [],
    verdict = 'Audit complete.',
    rubric = {
      machineGates: 90,
      security: 85,
      correctness: 80,
      architecture: 90,
      standards: 85
    }
  } = data;

  const serializedData = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arena Audit Report — ${escapeHtml(project)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --card-hover: #1e293b;
      --text: #f3f4f6;
      --text-muted: #94a3b8;
      --brand: #00A9A5;
      --brand-glow: rgba(0, 169, 165, 0.2);
      --action: #F0A62A;
      --success: #10B981;
      --danger: #EF4444;
      --warning: #F59E0B;
      --info: #3B82F6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Vazirmatn", "IRANSans", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding-bottom: 60px;
    }
    .container { max-width: 1240px; margin: 0 auto; padding: 24px; }
    header {
      background: linear-gradient(180deg, #131b2e 0%, var(--bg) 100%);
      border-bottom: 1px solid var(--card-border);
      padding: 32px 0 24px 0;
    }
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }
    .title-area h1 {
      font-size: 28px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #fff;
    }
    .badge-pill {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: var(--brand-glow);
      color: var(--brand);
      border: 1px solid var(--brand);
    }
    .meta-text { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
    .score-circle {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 12px 24px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .score-number { font-size: 36px; font-weight: 900; line-height: 1; }
    .score-label { font-size: 12px; color: var(--text-muted); }
    .tabs-nav {
      display: flex;
      gap: 8px;
      margin: 24px 0;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 12px;
      overflow-x: auto;
    }
    .tab-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .tab-btn:hover { background: var(--card-bg); color: var(--text); }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--brand);
      border-color: var(--brand);
      box-shadow: 0 0 15px var(--brand-glow);
    }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--brand);
    }
    .stat-card.failed::after { background: var(--danger); }
    .stat-card.warning::after { background: var(--warning); }
    .stat-title { font-size: 13px; color: var(--text-muted); font-weight: 500; }
    .stat-value { font-size: 26px; font-weight: 800; margin: 8px 0; color: #fff; }
    .stat-desc { font-size: 12px; color: var(--text-muted); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }
    .card-title { font-size: 18px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 10px; }
    .stage-flow {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 16px 0;
    }
    .stage-step {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 16px;
      background: #0d1322;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      position: relative;
    }
    .step-num {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--brand-glow);
      color: var(--brand);
      font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .step-body h4 { font-size: 15px; font-weight: 700; margin-bottom: 4px; color: #fff; }
    .step-body p { font-size: 13px; color: var(--text-muted); }
    .filter-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
      background: #0d1322;
      padding: 14px;
      border-radius: 12px;
      border: 1px solid var(--card-border);
    }
    .search-input {
      flex: 1;
      min-width: 220px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 14px;
      color: #fff;
      font-size: 14px;
    }
    .filter-select {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 14px;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
    }
    .finding-item {
      background: #0d1322;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      transition: all 0.2s;
    }
    .finding-item:hover { border-color: #334155; }
    .finding-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .finding-where {
      font-family: monospace;
      font-size: 13px;
      direction: ltr;
      text-align: left;
      color: var(--brand);
      background: rgba(0, 169, 165, 0.1);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      text-transform: uppercase;
    }
    .badge-high { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-medium { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-low { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-verified { background: rgba(16, 185, 129, 0.2); color: #10B981; }
    .badge-unconfirmed { background: rgba(245, 158, 11, 0.2); color: #F59E0B; }
    .finding-problem { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .finding-evidence {
      background: #060911;
      border: 1px solid #1e293b;
      padding: 10px 14px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      direction: ltr;
      text-align: left;
      color: #cbd5e1;
      overflow-x: auto;
      margin-bottom: 10px;
    }
    .finding-verifier {
      font-size: 13px;
      color: var(--text-muted);
      border-right: 3px solid var(--brand);
      padding-right: 10px;
      margin-top: 8px;
    }
    .rubric-bar {
      margin-bottom: 16px;
    }
    .rubric-header {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 6px;
      color: #fff;
    }
    .progress-track {
      background: #1e293b;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--brand), #2dd4bf);
      border-radius: 999px;
    }
    .btn {
      background: var(--brand);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
    }
  </style>
</head>
<body>

<header>
  <div class="container">
    <div class="header-content">
      <div class="title-area">
        <h1>
          <span>🛡️</span>
          <span>گزارش ممیزی آرنا (Arena Audit)</span>
          <span class="badge-pill">${escapeHtml(project)}</span>
        </h1>
        <div class="meta-text">
          تاریخ ممیزی: <span id="audit-date">${new Date(timestamp).toLocaleString('fa-IR')}</span> · وضعیت: نهایی شده با روبریک ۵گانه
        </div>
      </div>
      <div class="score-circle">
        <div>
          <div class="score-number" style="color: ${getScoreColor(score)}">${score}</div>
          <div class="score-label">شاخص سلامت کدبیس</div>
        </div>
      </div>
    </div>
  </div>
</header>

<div class="container">

  <nav class="tabs-nav">
    <button class="tab-btn active" onclick="switchTab('overview')">📊 نمای کلی و وضعیت سلامت</button>
    <button class="tab-btn" onclick="switchTab('tournament')">⚔️ مراحل تورنمنت آرنا</button>
    <button class="tab-btn" onclick="switchTab('findings')">📋 یافته‌های ممیزی (<span id="findings-count">${findings.length}</span>)</button>
    <button class="tab-btn" onclick="switchTab('rubric')">⚖️ ماتریس امتیازدهی و روبریک</button>
  </nav>

  <!-- TAB 1: OVERVIEW -->
  <section id="tab-overview" class="tab-pane active">
    <div class="grid-stats">
      <div class="stat-card">
        <div class="stat-title">گیت‌های ماشینی (Automated Gates)</div>
        <div class="stat-value">${gates.filter(g => g.ok).length} / ${gates.length}</div>
        <div class="stat-desc">تست‌ها، تایپ‌چک و لینترهای اجرا شده</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">یافته‌های تأیید شده (Attack/Defend)</div>
        <div class="stat-value" style="color: #f87171;">${findings.filter(f => f.status === 'verified').length}</div>
        <div class="stat-desc">تأیید مستقل با بازخوانی مجدد خطوط کد</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">خطاهای رد شده (False Positives)</div>
        <div class="stat-value" style="color: var(--success);">${findings.filter(f => f.status === 'unconfirmed').length}</div>
        <div class="stat-desc">ادعاهای هوش مصنوعی که در فاز دفاع رد شدند</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">عدسی‌های اختصاصی پروژه</div>
        <div class="stat-value">${lenses.length || 5}</div>
        <div class="stat-desc">برگرفته از مستندات و قراردادهای دامنه</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">⚖️ جمع‌بندی و رأی قاضی ارشد (Principal Verdict)</h2>
      </div>
      <p style="font-size: 15px; color: #e2e8f0; line-height: 1.8;">
        ${escapeHtml(verdict)}
      </p>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">🚦 گیت‌های کنترل کیفیت ماشینی</h2>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${gates.map(g => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #0d1322; border: 1px solid var(--card-border); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 18px;">${g.ok ? '✅' : '❌'}</span>
              <span style="font-weight: 700; color: #fff;">${escapeHtml(g.name)}</span>
            </div>
            <span class="badge ${g.ok ? 'badge-low' : 'badge-high'}">${g.ok ? 'تأیید شد (EXIT 0)' : 'شکست (FAILED)'}</span>
          </div>
        `).join('') || '<div style="color: var(--text-muted);">گیت ماشینی ثبت نشد.</div>'}
      </div>
    </div>

    ${priorities.length > 0 ? `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">🎯 اولویت‌های اصلی اصلاح (Top Priorities)</h2>
      </div>
      <ol style="padding-right: 20px; color: #e2e8f0; line-height: 2;">
        ${priorities.map(p => `
          <li>
            <strong><code>${escapeHtml(p.where)}</code></strong> — ${escapeHtml(p.what)}
            <span class="badge ${p.severity === 'high' ? 'badge-high' : (p.severity === 'medium' ? 'badge-medium' : 'badge-low')}">
              ${p.severity === 'high' ? 'بحرانی' : (p.severity === 'medium' ? 'متوسط' : 'کم')}
            </span>
          </li>
        `).join('')}
      </ol>
    </div>
    ` : ''}
  </section>

  <!-- TAB 2: TOURNAMENT -->
  <section id="tab-tournament" class="tab-pane">
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">⚔️ معماری ۵ فاز تورنمنت آرنا</h2>
      </div>
      <div class="stage-flow">
        <div class="stage-step">
          <div class="step-num">۱</div>
          <div class="step-body">
            <h4>فاز ۱: اجرای گیت‌های واقعی ماشین (Hard Ground Truth)</h4>
            <p>دستورات <code>tsc --noEmit</code>، <code>eslint</code> و <code>vitest</code> مستقیماً اجرا شده و کدهای خروج ماشین ثبت می‌شوند. بدون اتکا به فرض‌های ذهنی مدل.</p>
          </div>
        </div>
        <div class="stage-step">
          <div class="step-num">۲</div>
          <div class="step-body">
            <h4>فاز ۲: استخراج پویا و هوشمند عدسی‌های ممیزی</h4>
            <p>یک ایجنت طراح، فایل‌های قوانین (<code>AGENTS.md</code>، <code>CLAUDE.md</code>، <code>README.md</code>) را مطالعه کرده و قراردادهای اصلی دامنه را به کارت‌های استراتژی تبدیل می‌کند.</p>
          </div>
        </div>
        <div class="stage-step">
          <div class="step-num">۳</div>
          <div class="step-body">
            <h4>فاز ۳: بررسی موازی ممیزهای تخصصی</h4>
            <p>برای هر عدسی یک ممیز ارشد مستقل مستقر می‌شود تا کد را به صورت دقیق با ذکر خطوط (<code>path:line</code>) ارزیابی کند.</p>
          </div>
        </div>
        <div class="stage-step">
          <div class="step-num">۴</div>
          <div class="step-body">
            <h4>فاز ۴: فاز حمله و دفاع (Attack / Defend Verification)</h4>
            <p><strong>حذف توهم هوش مصنوعی:</strong> هر یافته بلافاصله به یک تأییدکنندهٔ خصمانه ارجاع می‌شود تا ادعا را نقض کند. تنها یافته‌هایی که بازخوانی مجدد کد را پشت سر بگذارند، تأیید می‌شوند.</p>
          </div>
        </div>
        <div class="stage-step">
          <div class="step-num">۵</div>
          <div class="step-body">
            <h4>فاز ۵: داوری قاضی نهایی و روبریک وزنی</h4>
            <p>قاضی ارشد یافته‌های هم‌پوشان را ادغام، بر اساس ماتریس خطر اولویت‌بندی، و گزارش تحلیلی را تولید می‌کند.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- TAB 3: FINDINGS MATRIX -->
  <section id="tab-findings" class="tab-pane">
    <div class="filter-bar">
      <input type="text" id="search-box" class="search-input" placeholder="جستجو در یافته‌ها یا مسیر فایل..." oninput="filterFindings()">
      <select id="severity-filter" class="filter-select" onchange="filterFindings()">
        <option value="all">تمام شدت‌ها</option>
        <option value="high">بحرانی (High)</option>
        <option value="medium">متوسط (Medium)</option>
        <option value="low">کم (Low)</option>
      </select>
      <select id="status-filter" class="filter-select" onchange="filterFindings()">
        <option value="all">تمام وضعیت‌ها</option>
        <option value="verified">تأیید شده (Verified)</option>
        <option value="unconfirmed">رد شده / نیاز به بازبینی</option>
      </select>
    </div>

    <div id="findings-list">
      ${findings.map((f, i) => `
        <div class="finding-item" data-severity="${f.severity}" data-status="${f.status}" data-text="${escapeHtml((f.problem + ' ' + f.path + ' ' + (f.evidence || '')).toLowerCase())}">
          <div class="finding-top">
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="badge ${f.severity === 'high' ? 'badge-high' : (f.severity === 'medium' ? 'badge-medium' : 'badge-low')}">
                ${f.severity === 'high' ? 'بحرانی' : (f.severity === 'medium' ? 'متوسط' : 'کم')}
              </span>
              <span class="badge ${f.status === 'verified' ? 'badge-verified' : 'badge-unconfirmed'}">
                ${f.status === 'verified' ? 'تأیید شده ✓' : 'رد شده / شکاف مدرک ✗'}
              </span>
              <span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(f.lens || 'ممیزی عمومی')}</span>
            </div>
            <a href="vscode://file/${escapeHtml(f.path)}" class="finding-where" title="کلیک برای باز کردن در ادیتور">
              ${escapeHtml(f.path || f.where || '')} ↗
            </a>
          </div>
          <div class="finding-problem">${escapeHtml(f.problem || f.what || '')}</div>
          ${f.evidence ? `<pre class="finding-evidence"><code>${escapeHtml(f.evidence)}</code></pre>` : ''}
          <div class="finding-verifier">
            <strong>توضیح تأییدکننده:</strong> ${escapeHtml(f.verifierNote || f.note || 'بدون یادداشت تکمیلی')}
          </div>
        </div>
      `).join('') || '<div class="card" style="text-align: center; color: var(--text-muted);">یافته‌ای ثبت نشد.</div>'}
    </div>
  </section>

  <!-- TAB 4: RUBRIC -->
  <section id="tab-rubric" class="tab-pane">
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">⚖️ ماتریس امتیازدهی روبریک (Evaluation Rubric)</h2>
      </div>
      <div class="rubric-bar">
        <div class="rubric-header">
          <span>۱. درستی گیت‌های ماشینی (Machine Integrity)</span>
          <span>${rubric.machineGates}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${rubric.machineGates}%;"></div></div>
      </div>
      <div class="rubric-bar">
        <div class="rubric-header">
          <span>۲. امنیت اسرار و اعتبارسنجی (Security & Secrets)</span>
          <span>${rubric.security}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${rubric.security}%;"></div></div>
      </div>
      <div class="rubric-bar">
        <div class="rubric-header">
          <span>۳. درستی محاسبات و منطق دامنه (Domain Correctness)</span>
          <span>${rubric.correctness}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${rubric.correctness}%;"></div></div>
      </div>
      <div class="rubric-bar">
        <div class="rubric-header">
          <span>۴. ساختار، مرزهای لایه و ماژولار بودن (Architecture)</span>
          <span>${rubric.architecture}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${rubric.architecture}%;"></div></div>
      </div>
      <div class="rubric-bar">
        <div class="rubric-header">
          <span>۵. انطباق با استانداردها و اسناد پروژه (Standards)</span>
          <span>${rubric.standards}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${rubric.standards}%;"></div></div>
      </div>
    </div>
  </section>

</div>

<script>
  const AUDIT_DATA = ${serializedData};

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (btn) btn.classList.add('active');
    const target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');
  }

  function filterFindings() {
    const query = (document.getElementById('search-box').value || '').toLowerCase().trim();
    const severity = document.getElementById('severity-filter').value;
    const status = document.getElementById('status-filter').value;

    const items = document.querySelectorAll('.finding-item');
    let visibleCount = 0;

    items.forEach(item => {
      const itemSev = item.getAttribute('data-severity');
      const itemStat = item.getAttribute('data-status');
      const itemText = item.getAttribute('data-text');

      const matchesQuery = !query || itemText.includes(query);
      const matchesSev = severity === 'all' || itemSev === severity;
      const matchesStat = status === 'all' || itemStat === status;

      if (matchesQuery && matchesSev && matchesStat) {
        item.style.display = 'block';
        visibleCount++;
      } else {
        item.style.display = 'none';
      }
    });

    document.getElementById('findings-count').innerText = visibleCount;
  }
</script>

</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getScoreColor(s) {
  if (s >= 80) return '#10B981';
  if (s >= 60) return '#F59E0B';
  return '#EF4444';
}
