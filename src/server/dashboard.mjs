/**
 * Arena Audit — Control Plane Web Dashboard (P15-08, minimal v1)
 * Single-page, same-origin, zero dependencies. Served at "/" by the API.
 */

export function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" class="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arena Control Plane</title>
<style>
  :root { --bg:#090d16; --card:#111827; --border:#1f293d; --text:#f3f4f6; --muted:#94a3b8; --brand:#00A9A5; --ok:#10B981; --warn:#F59E0B; --bad:#EF4444; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Vazirmatn,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
  h1 { font-size:22px; display:flex; gap:10px; align-items:center; margin-bottom:18px; }
  .pill { font-size:12px; background:rgba(0,169,165,.15); color:var(--brand); border:1px solid var(--brand); border-radius:999px; padding:2px 10px; }
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { background:none; border:1px solid transparent; color:var(--muted); padding:8px 16px; border-radius:10px; cursor:pointer; font-weight:600; }
  .tab.active { background:var(--card); color:var(--brand); border-color:var(--brand); }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  th,td { padding:10px 14px; text-align:right; font-size:13px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:600; background:#0d1322; }
  tr:hover td { background:#101828; }
  code { direction:ltr; font-size:12px; color:#93c5fd; }
  .badge { font-size:11px; padding:2px 8px; border-radius:6px; font-weight:700; }
  .b-high { background:rgba(239,68,68,.15); color:#f87171; }
  .b-medium { background:rgba(245,158,11,.15); color:#fbbf24; }
  .b-low { background:rgba(16,185,129,.15); color:#34d399; }
  .b-verified { color:var(--ok); } .b-known { color:var(--warn); } .b-new { color:#60a5fa; }
  select, button.act { background:#0d1322; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin-inline-start:6px; }
  button.act:hover { border-color:var(--brand); }
  .score { font-weight:800; }
  .empty { color:var(--muted); text-align:center; padding:32px; background:var(--card); border:1px dashed var(--border); border-radius:12px; }
</style>
</head>
<body>
  <h1>🛡️ Arena Control Plane <span class="pill">v1</span></h1>
  <div class="tabs">
    <button class="tab active" onclick="show('runs')">📊 اجراها</button>
    <button class="tab" onclick="show('findings')">📋 یافته‌ها</button>
    <button class="tab" onclick="show('trends')">📈 روند</button>
  </div>
  <div id="runs"></div>
  <div id="findings" style="display:none"></div>
  <div id="trends" style="display:none"></div>
<script>
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}
function show(id) {
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', ['runs','findings','trends'][i]===id));
  ['runs','findings','trends'].forEach(x => document.getElementById(x).style.display = x===id ? 'block':'none');
  if (id==='runs') loadRuns(); if (id==='findings') loadFindings(); if (id==='trends') loadTrends();
}
async function loadProjects() {
  const projects = await api('/api/projects');
  return projects;
}
async function loadRuns() {
  const projects = await loadProjects();
  if (!projects.length) { document.getElementById('runs').innerHTML = '<div class="empty">هنوز پروژه‌ای ingest نشده — از CLI با --push اجرا بگیرید.</div>'; return; }
  let html = '<table><tr><th>پروژه</th><th>Run</th><th>حالت</th><th>امتیاز</th><th>پوشش</th><th>تأییدشده</th><th>جدید</th><th>تاریخ</th></tr>';
  for (const p of projects) {
    const runs = await api('/api/projects/' + p.id + '/runs');
    for (const r of runs.slice(0, 10)) {
      html += \`<tr><td>\${esc(p.name)}</td><td><code>\${esc(r.runId)}</code></td><td>\${esc(r.mode)}</td>
        <td class="score">\${r.overall ?? 'N/A'}</td><td>\${r.coveragePercent}%</td>
        <td>\${r.verifiedCount}</td><td>\${r.newCount ? '<span class="badge b-new">'+r.newCount+'</span>' : 0}</td>
        <td>\${esc((r.finishedAt||'').slice(0,16).replace('T',' '))}</td></tr>\`;
    }
  }
  document.getElementById('runs').innerHTML = html + '</table>';
}
async function loadFindings() {
  const qs = document.getElementById('f-sev')?.value || '';
  const projects = await loadProjects();
  let rows = '';
  for (const p of projects) {
    const fs = await api('/api/findings?projectId=' + p.id + (qs ? '&severity=' + qs : ''));
    for (const f of fs) {
      rows += \`<tr><td>\${esc(p.name)}</td>
        <td><code>\${esc(f.path)}</code></td><td>\${esc(f.problem)}</td>
        <td><span class="badge b-\${esc(f.severity)}">\${esc(f.severity)}</span></td>
        <td class="b-\${esc(f.status==='verified'?'verified':'known')}">\${esc(f.status)}</td>
        <td>\${esc(f.baselineState||'')}</td>
        <td>
          <select onchange="resolve('\${esc(f.id)}', this.value)">
            <option value="">اقدام…</option>
            <option value="fixed">fixed</option>
            <option value="accepted_risk">accepted_risk</option>
            <option value="false_positive">false_positive</option>
            <option value="reopened">reopened</option>
          </select>
        </td></tr>\`;
    }
  }
  document.getElementById('findings').innerHTML =
    '<div style="margin-bottom:10px"><select id="f-sev" onchange="loadFindings()"><option value="">همهٔ شدت‌ها</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>' +
    (rows ? '<table><tr><th>پروژه</th><th>مسیر</th><th>مشکل</th><th>شدت</th><th>وضعیت</th><th>Baseline</th><th>Triage</th></tr>' + rows + '</table>'
          : '<div class="empty">یافته‌ای ثبت نشده.</div>');
}
async function resolve(id, resolution) {
  if (!resolution) return;
  await api('/api/findings/' + id + '/resolve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ resolution }) });
  loadFindings();
}
async function loadTrends() {
  const projects = await loadProjects();
  if (!projects.length) { document.getElementById('trends').innerHTML = '<div class="empty">داده‌ای نیست.</div>'; return; }
  let html = '<table><tr><th>پروژه</th><th>Run</th><th>امتیاز</th><th>پوشش</th><th>تأییدشده</th><th>جدید</th><th>تاریخ</th></tr>';
  for (const p of projects) {
    for (const t of await api('/api/projects/' + p.id + '/trends')) {
      html += \`<tr><td>\${esc(p.name)}</td><td><code>\${esc(t.runId)}</code></td><td class="score">\${t.overall ?? 'N/A'}</td><td>\${t.coveragePercent}%</td><td>\${t.verified}</td><td>\${t.new}</td><td>\${esc((t.finishedAt||'').slice(0,16).replace('T',' '))}</td></tr>\`;
    }
  }
  document.getElementById('trends').innerHTML = html + '</table>';
}
loadRuns();
</script>
</body>
</html>`;
}
