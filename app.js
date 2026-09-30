/* 多投 · 秋招投递记录 — GitHub Pages + Supabase */
'use strict';

// ---------- 常量 ----------
const STAGES = ['投递', '测评', '一面', '二面', '三面', 'Offer'];
const TERMINAL = ['拒绝', '放弃'];
const ALL_STAGES = [...STAGES, ...TERMINAL];
const COLORS = {
  '投递': '#2B6CFF', '测评': '#7B61FF', '一面': '#F5A623', '二面': '#F2792F',
  '三面': '#E8590C', 'Offer': '#22A65B', '拒绝': '#EB5757', '放弃': '#9AA0A6',
};

// ---------- 状态 ----------
let sb = null;
let user = null;
let records = [];
let editingId = null;          // null = 新增
let draftStage = '投递';
let draftDates = {};           // stage -> 'YYYY-MM-DD'
let searchState = { kw: '', stage: '全部', base: '', sort: 'update_desc' };
let currentView = 'home';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 工具 ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return isoOf(new Date()); }
function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); }

// 自然语言日期解析：今天/昨天/前天/明天/大后天/N天前/N天后/2026年9月28日/2026-9-28/9月28日/9/28
function parseDate(text) {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  if (t === '今天' || t === '今日') return todayStr();
  if (t === '昨天') return shiftDays(-1);
  if (t === '前天') return shiftDays(-2);
  if (t === '明天') return shiftDays(1);
  if (t === '后天') return shiftDays(2);
  if (t === '大后天') return shiftDays(3);
  let m = t.match(/^(\d{1,3})\s*天前$/); if (m) return shiftDays(-parseInt(m[1], 10));
  m = t.match(/^(\d{1,3})\s*天后$/); if (m) return shiftDays(parseInt(m[1], 10));
  m = t.match(/^(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?$/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : isoOf(d); }
  m = t.match(/^(\d{1,2})[月\-\/](\d{1,2})日?$/);
  if (m) { const d = new Date(new Date().getFullYear(), +m[1] - 1, +m[2]); return isNaN(d) ? null : isoOf(d); }
  return null;
}

function formatDateCN(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const now = new Date();
  return y === now.getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- 视图切换 ----------
function showView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-auth').classList.add('hidden');
  $('#app-root').classList.remove('hidden');
  const map = { home: '#view-home', list: '#view-list', search: '#view-search', edit: '#view-edit', detail: '#view-detail' };
  $(map[name]).classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.nav === name || (name === 'detail' && b.dataset.nav === 'list')));
  if (name === 'home') renderHome();
  if (name === 'list') renderList();
  if (name === 'search') renderSearch();
  if (name === 'edit') renderEdit();
  if (name === 'detail') renderDetail();
}

// ---------- 认证 ----------
async function initAuth() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    $('#view-auth').classList.remove('hidden');
    $('#auth-error').textContent = '请先在 config.js 里填入 SUPABASE_URL 和 SUPABASE_ANON_KEY';
    $('#btn-signin').disabled = true; $('#btn-signup').disabled = true;
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  if (data && data.session) {
    user = data.session.user;
    await enterApp();
  } else {
    $('#view-auth').classList.remove('hidden');
  }
  sb.auth.onAuthStateChange((_evt, session) => {
    if (!session && user) { user = null; records = []; location.reload(); }
  });
}

async function enterApp() {
  $('#view-auth').classList.add('hidden');
  $('#app-root').classList.remove('hidden');
  $('#user-email').textContent = user.email || '';
  await loadRecords();
  showView('home');
}

async function loadRecords() {
  const { data, error } = await sb.from('applications')
    .select('*').order('update_time', { ascending: false });
  if (error) { toast('加载失败：' + error.message); return; }
  records = data || [];
}

// ---------- 装饰 ----------
function progressCount(rec) {
  return STAGES.filter(s => rec.stage_dates && rec.stage_dates[s]).length;
}

function timelineHTML(rec) {
  const idx = ALL_STAGES.indexOf(rec.stage);
  return `<div class="timeline">` + STAGES.map((s, i) => {
    const done = rec.stage_dates && rec.stage_dates[s];
    const current = ALL_STAGES.indexOf(rec.stage) === i;
    const terminalIdx = idx >= STAGES.length;
    const cls = done ? 'done' : (current && !terminalIdx ? 'done current' : '');
    return `<div class="tdot-wrap"><div class="tdot ${cls}"></div><div class="tlabel ${current ? 'on' : ''}">${s}</div></div>`;
  }).join('') + `</div>`;
}

function recCardHTML(rec) {
  const color = COLORS[rec.stage] || '#9AA0A6';
  const bits = [rec.position, rec.base].filter(Boolean).map(esc).join(' · ');
  const applyText = rec.apply_date ? `投递 ${formatDateCN(rec.apply_date)}` : '';
  return `<div class="rec" data-id="${rec.id}">
    <div class="rec-head">
      <div style="flex:1;min-width:0">
        <div class="rec-title">${esc(rec.company)}</div>
        ${bits ? `<div class="rec-sub">${bits}</div>` : ''}
      </div>
      <span class="pill" style="background:${color}">${esc(rec.stage)}</span>
    </div>
    ${timelineHTML(rec)}
    <div class="rec-meta">${esc(applyText)}${applyText ? ' · ' : ''}更新于 ${relTime(rec.update_time)}</div>
  </div>`;
}

// ---------- 首页 ----------
function renderHome() {
  const total = records.length;
  const offers = records.filter(r => r.stage === 'Offer').length;
  const rejects = records.filter(r => TERMINAL.includes(r.stage)).length;
  $('#stat-total').textContent = total;
  $('#stat-active').textContent = total - offers - rejects;
  $('#stat-offer').textContent = offers;
  $('#stat-reject').textContent = rejects;
  const recent = records.slice(0, 5);
  $('#home-list').innerHTML = recent.length
    ? recent.map(recCardHTML).join('')
    : `<div class="empty">还没有投递记录，点上方「＋ 添加」开始</div>`;
}

// ---------- 投递列表 ----------
function renderList() {
  $('#list-count').textContent = `共 ${records.length} 条`;
  $('#list-box').innerHTML = records.length
    ? records.map(recCardHTML).join('')
    : `<div class="empty">暂无记录</div>`;
}

// ---------- 搜索 ----------
function filteredRecords() {
  const kw = searchState.kw.trim().toLowerCase();
  const base = searchState.base.trim().toLowerCase();
  let list = records.filter(r => {
    if (searchState.stage !== '全部' && r.stage !== searchState.stage) return false;
    if (base && !(r.base || '').toLowerCase().includes(base)) return false;
    if (kw) {
      const hay = [r.company, r.sub_unit, r.position, r.remark, r.base]
        .map(x => (x || '').toLowerCase()).join(' ');
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  if (searchState.sort === 'apply_desc') {
    list = [...list].sort((a, b) => (b.apply_date || '').localeCompare(a.apply_date || ''));
  } else if (searchState.sort === 'apply_asc') {
    list = [...list].sort((a, b) => (a.apply_date || '9').localeCompare(b.apply_date || '9'));
  }
  return list;
}

function renderSearch() {
  const stageChips = ['全部', ...ALL_STAGES].map(s =>
    `<span class="chip ${searchState.stage === s ? 'on' : ''}" data-stage="${s}">${s}</span>`).join('');
  $('#search-stages').innerHTML = stageChips;
  const list = filteredRecords();
  $('#search-count').textContent = `找到 ${list.length} 条`;
  $('#search-list').innerHTML = list.length
    ? list.map(recCardHTML).join('')
    : `<div class="empty">没有匹配的记录</div>`;
}

// ---------- 编辑 ----------
function renderEdit() {
  const rec = editingId ? records.find(r => r.id === editingId) : null;
  $('#edit-title').textContent = rec ? '编辑投递' : '添加投递';
  $('#btn-delete').classList.toggle('hidden', !rec);
  $('#f-company').value = rec ? rec.company : '';
  $('#f-base').value = rec ? (rec.base || '') : '';
  $('#f-sub').value = rec ? (rec.sub_unit || '') : '';
  $('#f-position').value = rec ? (rec.position || '') : '';
  $('#f-link').value = rec ? (rec.link || '') : '';
  $('#f-remark').value = rec ? (rec.remark || '') : '';
  draftStage = rec ? rec.stage : '投递';
  draftDates = rec && rec.stage_dates ? { ...rec.stage_dates } : {};
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('');
  renderDateRows();
}

function renderDateRows() {
  $('#edit-dates').innerHTML = ALL_STAGES.map(s => `
    <div class="date-row">
      <div class="date-name"><span class="date-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input class="date-input" data-ds="${s}" placeholder="今天 / 3天前 / 9月28日"
             value="${draftDates[s] ? esc(draftDates[s]) : ''}">
      <input type="date" class="date-picker" data-dp="${s}" value="${draftDates[s] ? esc(draftDates[s]) : ''}">
      <button class="date-act" data-today="${s}">今日</button>
      <button class="date-act clear" data-clear="${s}">清除</button>
    </div>`).join('');
}

function collectForm() {
  const stage_dates = {};
  for (const s of ALL_STAGES) {
    const v = (draftDates[s] || '').trim();
    if (v) stage_dates[s] = v;
  }
  return {
    company: $('#f-company').value.trim(),
    base: $('#f-base').value.trim() || null,
    sub_unit: $('#f-sub').value.trim() || null,
    position: $('#f-position').value.trim() || null,
    link: $('#f-link').value.trim() || null,
    remark: $('#f-remark').value.trim() || null,
    stage: draftStage,
    stage_dates,
    apply_date: stage_dates['投递'] || null,
    update_time: new Date().toISOString(),
  };
}

async function saveRecord() {
  const payload = collectForm();
  if (!payload.company) { toast('单位名称必填'); $('#f-company').focus(); return; }
  let error;
  if (editingId) {
    ({ error } = await sb.from('applications').update(payload).eq('id', editingId));
  } else {
    ({ error } = await sb.from('applications').insert(payload));
  }
  if (error) { toast('保存失败：' + error.message); return; }
  toast('已保存');
  editingId = null;
  await loadRecords();
  showView('list');
}

async function deleteRecord() {
  if (!editingId) return;
  if (!confirm('确定删除这条投递记录？')) return;
  const { error } = await sb.from('applications').delete().eq('id', editingId);
  if (error) { toast('删除失败：' + error.message); return; }
  toast('已删除');
  editingId = null;
  await loadRecords();
  showView('list');
}

// ---------- 详情 ----------
let detailId = null;
function renderDetail() {
  const rec = records.find(r => r.id === detailId);
  if (!rec) { showView('list'); return; }
  const rows = [
    ['二级单位', rec.sub_unit], ['Base 地', rec.base], ['岗位名称', rec.position],
  ].filter(([, v]) => v);
  const linkRow = rec.link
    ? `<div class="h-row"><div class="h-k">投递链接</div><div class="h-v"><a href="${esc(rec.link)}" target="_blank" rel="noopener">${esc(rec.link)}</a></div></div>` : '';
  const remarkRow = rec.remark
    ? `<div class="h-row"><div class="h-k">备注</div><div class="h-v">${esc(rec.remark)}</div></div>` : '';
  $('#detail-box').innerHTML = `
    <div class="card">
      <div class="h-company">${esc(rec.company)}</div>
      <div class="h-sub">${esc(rec.position || '')}${rec.position && rec.base ? ' · ' : ''}${esc(rec.base || '')}</div>
      <div class="h-rows">
        ${rows.map(([k, v]) => `<div class="h-row"><div class="h-k">${k}</div><div class="h-v">${esc(v)}</div></div>`).join('')}
        ${linkRow}${remarkRow}
      </div>
    </div>
    <div class="sec-title">当前阶段（点选切换）</div>
    <div class="card"><div id="detail-stages" class="chips">
      ${ALL_STAGES.map(s => `<span class="chip ${rec.stage === s ? 'on' : ''}" data-dstage="${s}" style="${rec.stage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('')}
    </div></div>
    <div class="sec-title">各阶段日期</div>
    <div class="card">
      ${ALL_STAGES.map(s => `
        <div class="tl-row">
          <span class="tl-dot" style="background:${COLORS[s]}"></span>
          <span class="tl-name">${s}</span>
          <span class="tl-date ${rec.stage_dates && rec.stage_dates[s] ? '' : 'placeholder'}">${rec.stage_dates && rec.stage_dates[s] ? formatDateCN(rec.stage_dates[s]) : '未记录'}</span>
          <button class="date-act" data-dtoday="${s}">今天</button>
          ${rec.stage_dates && rec.stage_dates[s] ? `<button class="date-act clear" data-dclear="${s}">清除</button>` : ''}
        </div>`).join('')}
    </div>
    <div class="actions">
      <button class="btn ghost" data-act="edit">编辑全部</button>
      <button class="btn danger" data-act="del">删除</button>
    </div>`;
}

async function patchRecord(id, patch) {
  patch.update_time = new Date().toISOString();
  const { data, error } = await sb.from('applications').update(patch).eq('id', id).select().single();
  if (error) { toast('更新失败：' + error.message); return; }
  const i = records.findIndex(r => r.id === id);
  if (i >= 0) records[i] = data;
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 登录 / 注册
  $('#btn-signin').addEventListener('click', async () => {
    $('#auth-error').textContent = '';
    const { error } = await sb.auth.signInWithPassword({
      email: $('#auth-email').value.trim(), password: $('#auth-pass').value,
    });
    if (error) { $('#auth-error').textContent = error.message; return; }
    const { data } = await sb.auth.getSession();
    user = data.session.user;
    await enterApp();
  });
  $('#btn-signup').addEventListener('click', async () => {
    $('#auth-error').textContent = '';
    const { data, error } = await sb.auth.signUp({
      email: $('#auth-email').value.trim(), password: $('#auth-pass').value,
    });
    if (error) { $('#auth-error').textContent = error.message; return; }
    if (data.session) { user = data.session.user; await enterApp(); }
    else $('#auth-error').textContent = '注册成功，请到 Supabase 关闭邮箱确认后直接登录（或在邮箱里点确认链接）';
  });
  $('#btn-signout').addEventListener('click', () => sb.auth.signOut());

  // 导航
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.nav === 'edit') { editingId = null; }
    showView(b.dataset.nav);
  }));

  // 搜索
  $('#search-kw').addEventListener('input', (e) => { searchState.kw = e.target.value; renderSearch(); });
  $('#search-base').addEventListener('input', (e) => { searchState.base = e.target.value; renderSearch(); });
  $('#search-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    searchState.stage = t.dataset.stage; renderSearch();
  });
  $$('.sort-opt').forEach(b => b.addEventListener('click', () => {
    searchState.sort = b.dataset.sort;
    $$('.sort-opt').forEach(x => x.classList.toggle('on', x === b));
    renderSearch();
  }));

  // 卡片点击 → 详情
  ['home-list', 'list-box', 'search-list'].forEach(id => {
    $('#' + id).addEventListener('click', (e) => {
      const card = e.target.closest('.rec'); if (!card) return;
      detailId = Number(card.dataset.id);
      showView('detail');
    });
  });

  // 编辑页 chips
  $('#edit-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    draftStage = t.dataset.stage;
    renderEditStagesOnly();
  });
  // 编辑页日期输入（自然语言）
  $('#edit-dates').addEventListener('change', (e) => {
    const ds = e.target.closest('[data-ds]');
    if (ds) {
      const s = ds.dataset.ds;
      const parsed = ds.value.trim() ? (parseDate(ds.value) || ds.value.trim()) : '';
      draftDates[s] = parsed;
      renderDateRows();
      return;
    }
    const dp = e.target.closest('[data-dp]');
    if (dp) { draftDates[dp.dataset.dp] = dp.value || ''; renderDateRows(); }
  });
  $('#edit-dates').addEventListener('click', (e) => {
    const td = e.target.closest('[data-today]');
    if (td) { draftDates[td.dataset.today] = todayStr(); renderDateRows(); return; }
    const cl = e.target.closest('[data-clear]');
    if (cl) { delete draftDates[cl.dataset.clear]; renderDateRows(); }
  });

  // 保存 / 取消 / 删除
  $('#btn-save').addEventListener('click', saveRecord);
  $('#btn-cancel').addEventListener('click', () => { editingId = null; showView('list'); });
  $('#btn-delete').addEventListener('click', deleteRecord);

  // 详情页事件
  $('#detail-box').addEventListener('click', async (e) => {
    const rec = records.find(r => r.id === detailId);
    if (!rec) return;
    const ds = e.target.closest('[data-dstage]');
    if (ds) {
      const patch = { stage: ds.dataset.dstage };
      // 首次切到某阶段且无日期时，自动记录今天
      if (!(rec.stage_dates || {})[ds.dataset.dstage]) {
        patch.stage_dates = { ...(rec.stage_dates || {}), [ds.dataset.dstage]: todayStr() };
      }
      await patchRecord(rec.id, patch);
      renderDetail();
      return;
    }
    const dt = e.target.closest('[data-dtoday]');
    if (dt) {
      await patchRecord(rec.id, { stage_dates: { ...(rec.stage_dates || {}), [dt.dataset.dtoday]: todayStr() } });
      renderDetail(); return;
    }
    const dc = e.target.closest('[data-dclear]');
    if (dc) {
      const next = { ...(rec.stage_dates || {}) }; delete next[dc.dataset.dclear];
      await patchRecord(rec.id, { stage_dates: next });
      renderDetail(); return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'edit') { editingId = rec.id; showView('edit'); }
      if (act.dataset.act === 'del') { editingId = rec.id; deleteRecord(); }
    }
  });
}

// 切阶段时只刷新 chips（不重置表单）
function renderEditStagesOnly() {
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('');
}

// ---------- 启动 ----------
bindEvents();
initAuth();
