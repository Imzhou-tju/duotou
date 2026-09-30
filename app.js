/* 多投 · 秋招投递记录 — GitHub Pages + Supabase（北洋蓝 · Pipeline-First 极简） */
'use strict';

// ---------- 常量 ----------
const STAGES = ['投递', '测评', '笔试', '一面', '二面', '三面', 'Offer'];
const TERMINAL = ['拒绝', '放弃'];
const ALL_STAGES = [...STAGES, ...TERMINAL];
const COLORS = {
  '投递': '#2B6CFF', '测评': '#7B61FF', '笔试': '#9B51E0', '一面': '#F5A623', '二面': '#F2792F',
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
function formatUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  return 'https://' + u;
}

// ---------- 行政区划自动归一化 ----------
const PROV_CITY_MAP = {
  '北京市': ['北京'],
  '上海市': ['上海'],
  '天津市': ['天津'],
  '重庆市': ['重庆'],
  '河北省': ['石家庄','唐山','秦皇岛','邯郸','邢台','保定','张家口','承德','沧州','廊坊','衡水'],
  '山西省': ['太原','大同','阳泉','长治','晋城','朔州','晋中','运城','忻州','临汾','吕梁'],
  '内蒙古自治区': ['呼和浩特','包头','乌海','赤峰','通辽','鄂尔多斯','呼伦贝尔','巴彦淖尔','乌兰察布','兴安盟','锡林郭勒盟','阿拉善盟'],
  '辽宁省': ['沈阳','大连','鞍山','抚顺','本溪','丹东','锦州','营口','阜新','辽阳','盘锦','铁岭','朝阳','葫芦岛'],
  '吉林省': ['长春','吉林','四平','辽源','通化','白山','松原','白城','延边'],
  '黑龙江省': ['哈尔滨','齐齐哈尔','鸡西','鹤岗','双鸭山','大庆','伊春','佳木斯','七台河','牡丹江','黑河','绥化','大兴安岭'],
  '江苏省': ['南京','无锡','徐州','常州','苏州','南通','连云港','淮安','盐城','扬州','镇江','泰州','宿迁'],
  '浙江省': ['杭州','宁波','温州','嘉兴','湖州','绍兴','金华','衢州','舟山','台州','丽水'],
  '安徽省': ['合肥','芜湖','蚌埠','淮南','马鞍山','淮北','铜陵','安庆','黄山','滁州','阜阳','宿州','六安','亳州','池州','宣城'],
  '福建省': ['福州','厦门','莆田','三明','泉州','漳州','南平','龙岩','宁德'],
  '江西省': ['南昌','景德镇','萍乡','九江','新余','鹰潭','赣州','吉安','宜春','抚州','上饶'],
  '山东省': ['济南','青岛','淄博','枣庄','东营','烟台','潍坊','济宁','泰安','威海','日照','临沂','德州','聊城','滨州','菏泽'],
  '河南省': ['郑州','开封','洛阳','平顶山','安阳','鹤壁','新乡','焦作','濮阳','许昌','漯河','三门峡','南阳','商丘','信阳','周口','驻马店','济源'],
  '湖北省': ['武汉','黄石','十堰','宜昌','襄阳','鄂州','荆门','孝感','荆州','黄冈','咸宁','随州','恩施'],
  '湖南省': ['长沙','株洲','湘潭','衡阳','邵阳','岳阳','常德','张家界','益阳','郴州','永州','怀化','娄底','湘西'],
  '广东省': ['广州','深圳','珠海','汕头','佛山','韶关','湛江','肇庆','江门','茂名','惠州','梅州','汕尾','河源','阳江','清远','东莞','中山','潮州','揭阳','云浮'],
  '广西壮族自治区': ['南宁','柳州','桂林','梧州','北海','防城港','钦州','贵港','玉林','百色','贺州','河池','来宾','崇左'],
  '海南省': ['海口','三亚','三沙','儋州'],
  '四川省': ['成都','自贡','攀枝花','泸州','德阳','绵阳','广元','遂宁','内江','乐山','南充','眉山','宜宾','广安','达州','雅安','巴中','资阳','阿坝','甘孜','凉山'],
  '贵州省': ['贵阳','六盘水','遵义','安顺','毕节','铜仁','黔西南','黔东南','黔南'],
  '云南省': ['昆明','曲靖','玉溪','保山','昭通','丽江','普洱','临沧','楚雄','红河','文山','西双版纳','大理','德宏','怒江','迪庆'],
  '西藏自治区': ['拉萨','日喀则','昌都','林芝','山南','那曲','阿里'],
  '陕西省': ['西安','铜川','宝鸡','咸阳','渭南','延安','汉中','榆林','安康','商洛'],
  '甘肃省': ['兰州','嘉峪关','金昌','白银','天水','武威','张掖','平凉','酒泉','庆阳','定西','陇南','临夏','甘南'],
  '青海省': ['西宁','海东','海北','黄南','海南','果洛','玉树','海西'],
  '宁夏回族自治区': ['银川','石嘴山','吴忠','固原','中卫'],
  '新疆维吾尔自治区': ['乌鲁木齐','克拉玛依','吐鲁番','哈密','昌吉','博尔塔拉','巴音郭楞','阿克苏','克孜勒苏','喀什','和田','伊犁','塔城','阿勒泰'],
  '香港特别行政区': ['香港'],
  '澳门特别行政区': ['澳门'],
  '台湾省': ['台北','新北','高雄','台中','台南','桃园']
};

const CITY_LOOKUP = {};
const DIRECT_MUNICIPALITIES = ['北京市', '上海市', '天津市', '重庆市', '香港特别行政区', '澳门特别行政区'];

for (const [prov, cities] of Object.entries(PROV_CITY_MAP)) {
  for (const c of cities) {
    let suffix = '市';
    if (c.endsWith('盟') || c.endsWith('州') || c.endsWith('区')) suffix = '';
    const fullCity = c + suffix;
    const isDirect = DIRECT_MUNICIPALITIES.includes(prov);
    const standardName = isDirect ? prov : (prov + fullCity);

    CITY_LOOKUP[c] = standardName;
    CITY_LOOKUP[fullCity] = standardName;
    if (!isDirect) {
      CITY_LOOKUP[prov.replace(/省|自治区/g, '') + c] = standardName;
      CITY_LOOKUP[prov + c] = standardName;
      CITY_LOOKUP[prov + fullCity] = standardName;
    }
  }
}
const ALL_CITY_KEYS = Object.keys(CITY_LOOKUP).sort((a, b) => b.length - a.length);

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  if (CITY_LOOKUP[s]) return CITY_LOOKUP[s];
  if (/[/,、\s|&]/.test(s)) return s;

  for (const k of ALL_CITY_KEYS) {
    if (s.includes(k)) {
      return CITY_LOOKUP[k];
    }
  }
  return s;
}

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
  records = (data || []).map(r => {
    const derived = stageFromDates(r.stage_dates);
    if (derived) r.stage = derived;
    return r;
  });
}

// ---------- 阶段流水线（步骤条展示当前所处流程） ----------
function pipelineHTML(rec) {
  const currentStage = rec.stage || '投递';
  const isTerminal = TERMINAL.includes(currentStage);
  const curIdx = STAGES.indexOf(currentStage);
  const color = COLORS[currentStage] || '#2B6CFF';

  // 连线进度百分比（两端节点中心对齐）
  let fillPercent = 0;
  if (curIdx > 0) {
    fillPercent = (curIdx / (STAGES.length - 1)) * 100;
  }

  const stepsHTML = STAGES.map((s, i) => {
    const isPast = curIdx >= 0 && i < curIdx;
    const isCurrent = s === currentStage;
    const sColor = COLORS[s] || '#2B6CFF';

    let cls = 'pl-step';
    if (isPast) cls += ' done';
    if (isCurrent) cls += ' current';

    const dotStyle = isCurrent
      ? `background:${sColor}; border-color:${sColor}; box-shadow:0 0 0 3px ${sColor}33;`
      : (isPast ? `background:${sColor}; border-color:${sColor};` : '');
    const textStyle = isCurrent ? `color:${sColor}; font-weight:700;` : '';

    return `<div class="${cls}">
      <span class="pl-dot" style="${dotStyle}"></span>
      <span class="pl-text" style="${textStyle}">${s}</span>
    </div>`;
  }).join('');

  return `<div class="pipeline-wrap">
    <div class="pipeline">
      <div class="pl-line"></div>
      <div class="pl-fill" style="width:calc((100% - 100% / 7) * ${curIdx >= 0 ? curIdx / (STAGES.length - 1) : 0}); background:${color};"></div>
      ${stepsHTML}
    </div>
    ${isTerminal ? `<div class="pl-term-tip" style="color:${color}">当前终态 · ${currentStage}</div>` : ''}
  </div>`;
}
// ---------- 投递卡片 ----------
function recCardHTML(rec) {
  const color = COLORS[rec.stage] || '#9AA0A6';
  const normBase = normalizeLocation(rec.base);
  const bits = [rec.position, rec.sub_unit, normBase].filter(Boolean).map(esc).join(' · ');
  const stageDate = rec.stage_dates && rec.stage_dates[rec.stage];
  const stageDateText = stageDate ? ` (${stageDate})` : '';

  return `<div class="rec" data-id="${rec.id}">
    <div class="rec-top">
      <div class="rec-title">${esc(rec.company)}</div>
      <span class="pill" style="background:${color}">${esc(rec.stage)}</span>
    </div>
    ${bits ? `<div class="rec-sub">${bits}</div>` : ''}
    ${pipelineHTML(rec)}
    <div class="rec-foot">
      <span class="rec-meta">当前：<strong style="color:${color}">${esc(rec.stage)}</strong>${stageDateText} · 更新于 ${relTime(rec.update_time)}</span>
      ${rec.link ? '<span class="rec-badge">🔗 链接</span>' : ''}
      ${rec.remark ? '<span class="rec-badge">📝 备注</span>' : ''}
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
    const normB = normalizeLocation(r.base);
    if (searchState.stage !== '全部' && r.stage !== searchState.stage) return false;
    if (base && !([r.base, normB].some(x => (x || '').toLowerCase().includes(base)))) return false;
    if (kw) {
      const hay = [r.company, r.sub_unit, r.position, r.remark, r.base, normB].map(x => (x || '').toLowerCase()).join(' ');
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
  const hintEl = $('#f-base-hint');
  if (hintEl) hintEl.classList.add('hidden');
  $('#f-sub').value = rec ? (rec.sub_unit || '') : '';
  $('#f-position').value = rec ? (rec.position || '') : '';
  $('#f-link').value = rec ? (rec.link || '') : '';
  $('#f-remark').value = rec ? (rec.remark || '') : '';
  draftDates = rec && rec.stage_dates ? { ...rec.stage_dates }
    : (rec ? {} : { '投递': todayStr() });   // 新增时默认「投递」日为今天
  draftStage = stageFromDates(draftDates) || (rec ? rec.stage : '投递');
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}">${s}</span>`).join('');
  renderDateRows();
}
function renderDateRows() {
  $('#edit-dates').innerHTML = ALL_STAGES.map(s => `
    <div class="date-row">
      <div class="date-name"><span class="date-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input type="date" class="date-picker" data-dp="${s}" value="${draftDates[s] ? esc(draftDates[s]) : ''}">
      <div class="date-acts">
        <button type="button" class="date-act" data-today="${s}">今日</button>
        <button type="button" class="date-act" data-yesterday="${s}">昨天</button>
        <button type="button" class="date-act clear" data-clear="${s}">清除</button>
      </div>
    </div>`).join('');
}
function collectForm() {
  const stage_dates = {};
  for (const s of ALL_STAGES) {
    const v = (draftDates[s] || '').trim();
    if (v) stage_dates[s] = v;
  }
  const derived = stageFromDates(stage_dates);
  const rawBase = $('#f-base').value.trim();
  const normalizedBase = normalizeLocation(rawBase);
  return {
    company: $('#f-company').value.trim(),
    base: normalizedBase || null,
    sub_unit: $('#f-sub').value.trim() || null,
    position: $('#f-position').value.trim() || null,
    link: $('#f-link').value.trim() || null,
    remark: $('#f-remark').value.trim() || null,
    stage: derived || draftStage || '投递',
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
// 当前阶段 = 已填日期中最晚的那个阶段（日期是唯一事实来源）
function stageFromDates(dates) {
  let best = null, bestD = '';
  for (const s of ALL_STAGES) {
    const v = dates && dates[s];
    if (v && v >= bestD) { bestD = v; best = s; }  // >=：同一天时取流程靠后的阶段
  }
  return best;
}
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

  const tags = [];
  if (rec.position) tags.push(`<span class="sheet-tag"><span class="sheet-tag-lbl">岗位:</span> ${esc(rec.position)}</span>`);
  if (rec.sub_unit) tags.push(`<span class="sheet-tag"><span class="sheet-tag-lbl">部门:</span> ${esc(rec.sub_unit)}</span>`);
  const normBase = normalizeLocation(rec.base);
  if (normBase) tags.push(`<span class="sheet-tag"><span class="sheet-tag-lbl">Base:</span> ${esc(normBase)}</span>`);

  let linkHTML = '';
  if (rec.link) {
    const safeUrl = formatUrl(rec.link);
    linkHTML = `
      <div class="sheet-field sheet-link-card">
        <div class="sheet-field-label">投递链接</div>
        <div class="sheet-link-content">
          <a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="sheet-link-url" title="${esc(rec.link)}">
            <svg class="sheet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span class="sheet-link-text">${esc(rec.link)}</span>
            <span class="sheet-link-ext">访问 ↗</span>
          </a>
          <button class="sheet-copy-btn" data-copylink="${esc(rec.link)}" type="button">复制</button>
        </div>
      </div>`;
  }

  let remarkHTML = '';
  if (rec.remark) {
    remarkHTML = `
      <div class="sheet-field sheet-remark-card">
        <div class="sheet-field-label">备注信息</div>
        <div class="sheet-remark-text">${esc(rec.remark)}</div>
      </div>`;
  }

  const dates = ALL_STAGES.map(s => {
    const v = rec.stage_dates && rec.stage_dates[s];
    return `<div class="sheet-date-row">
      <div class="sd-name"><span class="sd-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input class="sheet-date-input" data-sds="${s}" placeholder="未记录 · 可填 今天 / 9月28日" value="${v ? esc(v) : ''}">
      <button class="date-act" data-sdtoday="${s}">今日</button>
    </div>`;
  }).join('');

  $('#sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-company">${esc(rec.company)}</div>
      <span class="pill" style="background:${color}">${esc(rec.stage)}</span>
    </div>
    ${tags.length ? `<div class="sheet-tags">${tags.join('')}</div>` : ''}
    ${linkHTML}
    ${remarkHTML}
    <div class="sheet-sec-title">阶段推进日期</div>
    <div class="sheet-dates">${dates}</div>
    <div class="sheet-actions">
      <button class="btn ghost" data-edit="${rec.id}">编辑全部</button>
      <button class="btn danger" data-del="${rec.id}">删除</button>
    </div>`;
}
async function patchSheetDate(id, stage, value) {
  const rec = records.find(r => r.id === id); if (!rec) return;
  const dates = { ...(rec.stage_dates || {}) };
  if (value) dates[stage] = value; else delete dates[stage];
  const derived = stageFromDates(dates);
  const patch = {
    stage_dates: dates,
    apply_date: dates['投递'] || null,
    update_time: new Date().toISOString(),
    stage: derived || '投递',
  };
  const { error } = await sb.from('applications').update(patch).eq('id', id);
  if (error) { toast('更新失败：' + error.message); return; }
  toast(value ? ('已记录 · 当前阶段：' + (derived || '投递')) : '已清除该日期');
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
    const cp = e.target.closest('[data-copylink]');
    if (cp) {
      const text = cp.dataset.copylink;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast('链接已复制')).catch(() => toast('复制失败'));
      } else {
        toast('请长按复制链接');
      }
      return;
    }
    const dt = e.target.closest('[data-sdtoday]');
    if (dt) { patchSheetDate(sheetId, dt.dataset.sdtoday, todayStr()); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { closeSheet(); editingId = Number(ed.dataset.edit); showView('edit'); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) { deleteRecord(Number(dl.dataset.del)); }
  });
  // 弹层日期直接编辑：解析自然语言/原生日期值，清空即删除该日期
  $('#sheet').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-sds]'); if (!inp) return;
    const raw = inp.value.trim();
    if (!raw) { patchSheetDate(sheetId, inp.dataset.sds, ''); return; }
    const v = parseDate(raw);
    if (!v) { toast('日期看不懂，试试 今天 / 3天前 / 9月28日'); renderSheet(sheetId); return; }
    patchSheetDate(sheetId, inp.dataset.sds, v);
  });

  // 编辑页 Base 地智能纠错与无感提示（不干扰打字速率）
  $('#f-base').addEventListener('input', (e) => {
    const raw = e.target.value.trim();
    const hint = $('#f-base-hint');
    if (!raw) {
      if (hint) hint.classList.add('hidden');
      return;
    }
    const norm = normalizeLocation(raw);
    if (norm && norm !== raw && hint) {
      hint.textContent = `📍 识别为: ${norm}`;
      hint.classList.remove('hidden');
    } else if (hint) {
      hint.classList.add('hidden');
    }
  });
  $('#f-base').addEventListener('blur', (e) => {
    const raw = e.target.value.trim();
    if (!raw) return;
    const norm = normalizeLocation(raw);
    if (norm && norm !== raw) {
      e.target.value = norm;
      const hint = $('#f-base-hint');
      if (hint) hint.classList.add('hidden');
    }
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
    const dp = e.target.closest('[data-dp]');
    if (dp) {
      draftDates[dp.dataset.dp] = dp.value || '';
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      renderDateRows();
      renderEditStagesOnly();
    }
  });
  $('#edit-dates').addEventListener('click', (e) => {
    const td = e.target.closest('[data-today]');
    if (td) {
      draftDates[td.dataset.today] = todayStr();
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      renderDateRows();
      renderEditStagesOnly();
      return;
    }
    const yt = e.target.closest('[data-yesterday]');
    if (yt) {
      draftDates[yt.dataset.yesterday] = shiftDays(-1);
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      renderDateRows();
      renderEditStagesOnly();
      return;
    }
    const cl = e.target.closest('[data-clear]');
    if (cl) {
      delete draftDates[cl.dataset.clear];
      const derived = stageFromDates(draftDates);
      draftStage = derived || '投递';
      renderDateRows();
      renderEditStagesOnly();
    }
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
