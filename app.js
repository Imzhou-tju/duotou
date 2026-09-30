/* 多投 · 秋招投递记录 — GitHub Pages + Supabase（北洋蓝 · Pipeline-First 极简） */
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
let editingId = null;
let draftStage = '投递';
let draftDates = {};
let feedFilter = 'all';
let searchState = { kw: '', stage: '全部', base: '' };
let currentView = 'feed';
let sheetId = null;

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

// 自然语言日期解析
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
  closeSheet();
  const map = { feed: '#view-feed', search: '#view-search', account: '#view-account', edit: '#view-edit' };
  if (map[name]) $(map[name]).classList.remove('hidden');
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.nav === name));
  if (name === 'feed') renderFeed();
  if (name === 'search') renderSearch();
  if (name === 'account') renderAccount();
  if (name === 'edit') renderEdit();
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
  showView('feed');
}

async function loadRecords() {
  const { data, error } = await sb.from('applications')
    .select('*').order('update_time', { ascending: false });
  if (error) { toast('加载失败：' + error.message); return; }
  records = data || [];
}

// ---------- 阶段流水线（记忆点） ----------
function pipelineHTML(rec) {
  const idx = STAGES.indexOf(rec.stage);
  const done = idx >= 0 ? idx + 1 : 0;
  const fill = done > 0 ? ((done - 1) / (STAGES.length - 1) * 100) : 0;
  const dots = STAGES.map((_, i) => `<span class="pl-dot ${i < done ? 'done' : ''}"></span>`).join('');
  return `<div class="pipeline"><div class="pl-fill" style="width:${fill}%"></div>${dots}</div>`;
}
// ---------- 投递卡片 ----------
function recCardHTML(rec) {
  const color = COLORS[rec.stage] || '#9AA0A6';
  const bits = [rec.position, rec.base].filter(Boolean).map(esc).join(' · ');
  return `<div class="rec" data-id="${rec.id}">
    <div class="rec-top">
      <div class="rec-title">${esc(rec.company)}</div>
      <span class="pill" style="background:${color}">${esc(rec.stage)}</span>
    </div>
    ${bits ? `<div class="rec-sub">${bits}</div>` : ''}
    ${pipelineHTML(rec)}
    <div class="rec-foot">
      <span class="rec-meta">更新于 ${relTime(rec.update_time)}</span>
    </div>
  </div>`;
}

// ---------- 投递动态（首页 feed） ----------
function feedFiltered() {
  if (feedFilter === 'all') return records;
  if (feedFilter === 'active') return records.filter(r => STAGES.includes(r.stage) && r.stage !== 'Offer');
  if (feedFilter === 'Offer') return records.filter(r => r.stage === 'Offer');
  if (feedFilter === 'reject') return records.filter(r => TERMINAL.includes(r.stage));
  return records;
}
function renderFeed() {
  const active = records.filter(r => STAGES.includes(r.stage) && r.stage !== 'Offer').length;
  const offers = records.filter(r => r.stage === 'Offer').length;
  const rejects = records.filter(r => TERMINAL.includes(r.stage)).length;
  $('#stat-active').textContent = active;
  $('#stat-offer').textContent = offers;
  $('#stat-reject').textContent = rejects;
  $('#stat-total').textContent = records.length;
  $$('#feed-filters .chip').forEach(c => c.classList.toggle('on', c.dataset.filter === feedFilter));
  const list = feedFiltered();
  $('#feed-list').innerHTML = list.length
    ? list.map(recCardHTML).join('')
    : `<div class="empty"><div class="big">还没有记录</div>点右下角 + 添加你的第一份投递</div>`;
}

// ---------- 搜索 ----------
function filteredRecords() {
  const kw = searchState.kw.trim().toLowerCase();
  const base = searchState.base.trim().toLowerCase();
  let list = records.filter(r => {
    if (searchState.stage !== '全部' && r.stage !== searchState.stage) return false;
    if (base && !(r.base || '').toLowerCase().includes(base)) return false;
    if (kw) {
      const hay = [r.company, r.sub_unit, r.position, r.remark, r.base].map(x => (x || '').toLowerCase()).join(' ');
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
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
  draftDates = rec && rec.stage_dates ? { ...rec.stage_dates }
    : (rec ? {} : { '投递': todayStr() });   // 新增时默认「投递」日为今天
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('');
  renderDateRows();
}
function renderDateRows() {
  $('#edit-dates').innerHTML = ALL_STAGES.map(s => `
    <div class="date-row">
      <div class="date-name"><span class="date-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input class="date-input" data-ds="${s}" placeholder="今天 / 3天前 / 9月28日" value="${draftDates[s] ? esc(draftDates[s]) : ''}">
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
  showView('feed');
}
async function deleteRecord(id) {
  id = id || editingId;
  if (!id) return;
  if (!confirm('确定删除这条投递记录？')) return;
  const { error } = await sb.from('applications').delete().eq('id', id);
  if (error) { toast('删除失败：' + error.message); return; }
  toast('已删除');
  editingId = null;
  closeSheet();
  await loadRecords();
  showView('feed');
}

// ---------- 详情底部弹层 ----------
function openSheet(id) {
  sheetId = id;
  renderSheet(id);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() {
  sheetId = null;
  $('#sheet').classList.add('hidden');
}
function renderSheet(id) {
  const rec = records.find(r => r.id === id); if (!rec) return;
  const color = COLORS[rec.stage] || '#9AA0A6';
  const bits = [rec.position, rec.base].filter(Boolean).map(esc).join(' · ');
  const stages = ALL_STAGES.map(s =>
    `<span class="chip ${rec.stage === s ? 'on' : ''}" data-dstage="${s}" style="${rec.stage === s ? 'background:' + color : ''}">${s}</span>`).join('');
  const dates = ALL_STAGES.map(s => {
    const v = rec.stage_dates && rec.stage_dates[s];
    return `<div class="sheet-date-row"><div class="sd-name"><span class="sd-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <div class="sd-val ${v ? '' : 'placeholder'}">${v ? formatDateCN(v) : '未记录'}</div></div>`;
  }).join('');
  $('#sheet-body').innerHTML = `
    <div class="sheet-company">${esc(rec.company)}</div>
    <div class="sheet-sub">${bits || ''}</div>
    <div class="sheet-stages">${stages}</div>
    <div class="sheet-dates">${dates}</div>
    <div class="sheet-actions">
      <button class="btn ghost" data-edit="${rec.id}">编辑全部</button>
      <button class="btn danger" data-del="${rec.id}">删除</button>
    </div>`;
}
async function patchStage(id, stage) {
  const rec = records.find(r => r.id === id); if (!rec) return;
  const patch = { stage, update_time: new Date().toISOString() };
  if (!(rec.stage_dates || {})[stage]) {
    patch.stage_dates = { ...(rec.stage_dates || {}), [stage]: todayStr() };
    patch.apply_date = patch.stage_dates['投递'] || rec.apply_date || null;
  }
  const { error } = await sb.from('applications').update(patch).eq('id', id);
  if (error) { toast('更新失败：' + error.message); return; }
  await loadRecords();
  renderFeed();
  renderSheet(id);
}

// ---------- 账户 ----------
function renderAccount() {
  $('#account-email').textContent = user.email || '';
  $('#account-avatar').textContent = (user.email || '我')[0].toUpperCase();
}
function exportCSV() {
  const headers = ['单位', '二级单位', 'Base', '岗位', '阶段', '投递日期', '链接', '备注'];
  const rows = records.map(r => [r.company, r.sub_unit, r.base, r.position, r.stage, r.apply_date || '', r.link || '', r.remark || '']);
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const csv = [headers, ...rows].map(row => row.map(q).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `多投投递记录_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('已导出 CSV 到本地');
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 登录 / 注册
  $('#btn-signin').addEventListener('click', async () => {
    $('#auth-error').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#auth-email').value.trim(), password: $('#auth-pass').value });
    if (error) { $('#auth-error').textContent = error.message; return; }
    const { data } = await sb.auth.getSession();
    user = data.session.user;
    await enterApp();
  });
  $('#btn-signup').addEventListener('click', async () => {
    $('#auth-error').textContent = '';
    const { data, error } = await sb.auth.signUp({ email: $('#auth-email').value.trim(), password: $('#auth-pass').value });
    if (error) { $('#auth-error').textContent = error.message; return; }
    if (data.session) { user = data.session.user; await enterApp(); }
    else $('#auth-error').textContent = '注册成功，请到 Supabase 关闭邮箱确认后直接登录';
  });

  // 底部标签栏
  $$('.tab').forEach(b => b.addEventListener('click', () => showView(b.dataset.nav)));
  // 悬浮添加
  $('#fab').addEventListener('click', () => { editingId = null; showView('edit'); });

  // feed 筛选
  $('#feed-filters').addEventListener('click', (e) => {
    const t = e.target.closest('[data-filter]'); if (!t) return;
    feedFilter = t.dataset.filter; renderFeed();
  });

  // 列表卡片：点击打开详情（feed + search 共用）
  ['feed-list', 'search-list'].forEach(id => {
    $('#' + id).addEventListener('click', (e) => {
      const card = e.target.closest('.rec'); if (!card) return;
      openSheet(Number(card.dataset.id));
    });
  });

  // 搜索
  $('#search-kw').addEventListener('input', (e) => { searchState.kw = e.target.value; renderSearch(); });
  $('#search-base').addEventListener('input', (e) => { searchState.base = e.target.value; renderSearch(); });
  $('#search-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    searchState.stage = t.dataset.stage; renderSearch();
  });

  // 详情弹层
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const ds = e.target.closest('[data-dstage]');
    if (ds) { patchStage(sheetId, ds.dataset.dstage); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { closeSheet(); editingId = Number(ed.dataset.edit); showView('edit'); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) { deleteRecord(Number(dl.dataset.del)); }
  });

  // 编辑页
  $('#edit-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    draftStage = t.dataset.stage;
    // 选中某阶段时，若该阶段尚无日期则自动记为今天（与详情页一致，少一次手动填日期）
    if (!draftDates[draftStage]) { draftDates[draftStage] = todayStr(); renderDateRows(); }
    renderEditStagesOnly();
  });
  $('#edit-dates').addEventListener('change', (e) => {
    const ds = e.target.closest('[data-ds]');
    if (ds) { draftDates[ds.dataset.ds] = ds.value.trim() ? (parseDate(ds.value) || ds.value.trim()) : ''; renderDateRows(); return; }
    const dp = e.target.closest('[data-dp]');
    if (dp) { draftDates[dp.dataset.dp] = dp.value || ''; renderDateRows(); }
  });
  $('#edit-dates').addEventListener('click', (e) => {
    const td = e.target.closest('[data-today]');
    if (td) { draftDates[td.dataset.today] = todayStr(); renderDateRows(); return; }
    const cl = e.target.closest('[data-clear]');
    if (cl) { delete draftDates[cl.dataset.clear]; renderDateRows(); }
  });
  $('#btn-save').addEventListener('click', saveRecord);
  $('#btn-cancel').addEventListener('click', () => { editingId = null; showView('feed'); });
  $('#btn-delete').addEventListener('click', () => deleteRecord());

  // 账户
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-signout').addEventListener('click', () => sb.auth.signOut());
}

// 切阶段时只刷新 chips
function renderEditStagesOnly() {
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('');
}

// ---------- 启动 ----------
bindEvents();
initAuth();
