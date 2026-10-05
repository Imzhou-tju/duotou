/* 多投 · 秋招投递记录 — GitHub Pages + Supabase（北洋蓝 · Pipeline-First 极简） */
'use strict';
window.__appStarted = true;   // 告诉 index.html 的看门狗：主脚本已经跑起来了

// ---------- 常量 ----------
const STAGES = ['投递', '测评', '笔试', '一面', '二面', '三面', 'Offer'];
const TERMINAL = ['拒绝', '放弃'];
const ALL_STAGES = [...STAGES, ...TERMINAL];
const COLORS = {
  '投递': '#2B6CFF', '测评': '#7B61FF', '笔试': '#9B51E0', '一面': '#F5A623', '二面': '#F2792F',
  '三面': '#E8590C', 'Offer': '#22A65B', '拒绝': '#EB5757', '放弃': '#9AA0A6',
};

// ---------- 单位 / 岗位三层结构 ----------
// 一个「单位」下可投多个「岗位」，提交时按岗位展开成多条记录
const MAX_POSITIONS = 10;   // 单个单位最多岗位数
const MAX_UNITS = 20;       // 集团模式最多单位数
const MAX_RECORDS = 60;     // 单次提交最多记录数
// 备注图片：Supabase Storage 公开桶，路径固定 {user.id}/xxx，权限由 storage.objects 策略按目录限制
const IMG_BUCKET = 'remark-media';
const IMG_MAX_EDGE = 1600;      // 压缩后长边上限（px）
const IMG_MAX_EDGE_PNG = 2400;  // 截图类 PNG 文字多，放宽一点避免字糊
const MAX_IMGS_PER_POS = 4;     // 单个岗位最多几张
const MAX_IMG_INPUT_MB = 12;    // 选图时的原始体积上限
let uidSeq = 0;
function nextKey(p) { return p + (++uidSeq); }
// Base 地 / 备注挂在「岗位」上：同一个单位的不同岗位，Base 地和备注可能不一样（如总部岗 vs 外地岗）
function newPosition(name) { return { key: nextKey('p'), recId: null, name: name || '', base: '', remark: '', imgs: [] }; }
function newUnit() {
  return { key: nextKey('u'), recId: null, sub: '', date: todayStr(), positions: [newPosition()] };
}

// ---------- 状态 ----------
let sb = null;
let user = null;
let records = [];
let editingId = null;
let draftGroup = '';
let draftMode = 'single';   // 'single' 单个单位 | 'group' 集团投递
let draftUnits = [newUnit()];   // 表单里的单位列表：每个单位下挂多个岗位；单个单位模式只用第一个单位来装岗位
let groupEditStageDates = null;   // 集团模式编辑已有记录时，保留该记录原有的各阶段日期（投递日由行内输入覆盖）
let groupEditStage = '投递';
let draftStage = '投递';
let draftDates = {};
let feedFilter = 'all';
let searchState = { kw: '', stage: '全部', unit: '', position: '', base: '', sort: 'update' };
const PAGE_SIZE = 20;      // 列表每页展示的「卡片项」数（集团卡 / 单位卡 / 单卡，不会劈开一个单位）
let feedShown = PAGE_SIZE;
let searchShown = PAGE_SIZE;
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
  '上海市': ['上海', '浦东新区'],
  '天津市': ['天津', '滨海新区'],
  '重庆市': ['重庆', '两江新区'],
  '河北省': ['石家庄','唐山','秦皇岛','邯郸','邢台','保定','张家口','承德','沧州','廊坊','衡水','雄安新区'],
  '山西省': ['太原','大同','阳泉','长治','晋城','朔州','晋中','运城','忻州','临汾','吕梁'],
  '内蒙古自治区': ['呼和浩特','包头','乌海','赤峰','通辽','鄂尔多斯','呼伦贝尔','巴彦淖尔','乌兰察布','兴安盟','锡林郭勒盟','阿拉善盟'],
  '辽宁省': ['沈阳','大连','鞍山','抚顺','本溪','丹东','锦州','营口','阜新','辽阳','盘锦','铁岭','朝阳','葫芦岛'],
  '吉林省': ['长春','吉林','四平','辽源','通化','白山','松原','白城','延边'],
  '黑龙江省': ['哈尔滨','齐齐哈尔','鸡西','鹤岗','双鸭山','大庆','伊春','佳木斯','七台河','牡丹江','黑河','绥化','大兴安岭'],
  '江苏省': ['南京','无锡','徐州','常州','苏州','南通','连云港','淮安','盐城','扬州','镇江','泰州','宿迁','江北新区'],
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
  '四川省': ['成都','自贡','攀枝花','泸州','德阳','绵阳','广元','遂宁','内江','乐山','南充','眉山','宜宾','广安','达州','雅安','巴中','资阳','阿坝','甘孜','凉山','天府新区'],
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

// 自治州（后缀「州」，不加「市」；注意不能用 endsWith('州') 判断，会误伤福州/杭州/广州/苏州等）
const AUTONOMOUS = new Set(['延边','恩施','湘西','黔西南','黔东南','黔南','楚雄','红河','文山','西双版纳',
  '大理','德宏','怒江','迪庆','临夏','甘南','海北','黄南','海南','果洛','玉树','海西',
  '昌吉','博尔塔拉','巴音郭楞','克孜勒苏','伊犁','阿坝','甘孜','凉山']);
// 地区（后缀「地区」）
const REGIONS = new Set(['大兴安岭']);

const CITY_LOOKUP = {};
const DIRECT_MUNICIPALITIES = ['北京市', '上海市', '天津市', '重庆市', '香港特别行政区', '澳门特别行政区'];

for (const [prov, cities] of Object.entries(PROV_CITY_MAP)) {
  for (const c of cities) {
    let fullCity;
    if (c.endsWith('盟') || c.endsWith('新区')) fullCity = c;          // 兴安盟 / 浦东新区 等自带后缀
    else if (AUTONOMOUS.has(c)) fullCity = c + '州';                    // 延边州 / 阿坝州 …
    else if (REGIONS.has(c)) fullCity = c + '地区';                     // 大兴安岭地区
    else fullCity = c + '市';
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

// 常用短名 / 国家级新区简称 → 标准名（与上方同名新区共用标准化结果）
// 放在 ALL_CITY_KEYS 之前，使其也能参与子串匹配（如 "河北雄安" → 河北省雄安新区）
const CITY_SHORT_ALIAS = {
  '雄安': '河北省雄安新区',
  '浦东': '上海市',
  '滨海': '天津市',
  '两江': '重庆市',
};
Object.assign(CITY_LOOKUP, CITY_SHORT_ALIAS);

// 省份级：全称与常用简称 → 标准省名（「海南」优先归海南省，而不是青海的海南藏族自治州）
const PROV_ALIAS = {};
for (const prov of Object.keys(PROV_CITY_MAP)) PROV_ALIAS[prov] = prov;
Object.assign(PROV_ALIAS, {
  '北京': '北京市', '上海': '上海市', '天津': '天津市', '重庆': '重庆市',
  '河北': '河北省', '山西': '山西省', '辽宁': '辽宁省', '吉林': '吉林省', '黑龙江': '黑龙江省',
  '江苏': '江苏省', '浙江': '浙江省', '安徽': '安徽省', '福建': '福建省', '江西': '江西省',
  '山东': '山东省', '河南': '河南省', '湖北': '湖北省', '湖南': '湖南省', '广东': '广东省',
  '海南': '海南省', '四川': '四川省', '贵州': '贵州省', '云南': '云南省', '陕西': '陕西省',
  '甘肃': '甘肃省', '青海': '青海省', '台湾': '台湾省',
  '内蒙古': '内蒙古自治区', '广西': '广西壮族自治区', '西藏': '西藏自治区',
  '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区',
  '香港': '香港特别行政区', '澳门': '澳门特别行政区',
});

const ALL_CITY_KEYS = Object.keys(CITY_LOOKUP).sort((a, b) => b.length - a.length);

// 在字符串里找城市：先精确（省 → 城），再按最长子串匹配
function matchCity(str) {
  if (PROV_ALIAS[str]) return PROV_ALIAS[str];
  if (CITY_LOOKUP[str]) return CITY_LOOKUP[str];
  for (const k of ALL_CITY_KEYS) if (str.includes(k)) return CITY_LOOKUP[k];
  return '';
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  // 多地点写法（成都/深圳、成都、深圳）不做归一化，原样保留
  if (/[/,，、|&]/.test(s)) return s;
  // 「福建 莆田」「福建-莆田」「福建·莆田」这类「省 + 市」写法
  const parts = s.split(/[\s\-—–·]+/).filter(Boolean);
  if (parts.length === 2) {
    for (const [a, b] of [[parts[0], parts[1]], [parts[1], parts[0]]]) {
      const prov = PROV_ALIAS[a];
      if (!prov) continue;
      if (DIRECT_MUNICIPALITIES.includes(prov)) return prov;   // 直辖市 + 区名 → 直辖市
      const city = matchCity(b);
      if (city && city.startsWith(prov)) return city;          // 市必须确实属于这个省
    }
    return s;   // 两个都是城市（如「成都 深圳」）→ 视为多地点
  }
  return matchCity(s) || s;
}

// ---------- 备注图片：压缩 / 上传 / 删除 ----------
// 浏览器里先压缩再上传：手机截图动辄 2–5MB，直接传很快会撑爆免费额度。
// 截图（PNG）文字密集，压缩目标放宽、保留 PNG；照片走 JPEG。
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('只能选图片文件')); return; }
    if (file.size > MAX_IMG_INPUT_MB * 1024 * 1024) { reject(new Error(`图片超过 ${MAX_IMG_INPUT_MB}MB，先截小一点`)); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const keepPng = /png/i.test(file.type);
      const maxEdge = keepPng ? IMG_MAX_EDGE_PNG : IMG_MAX_EDGE;
      let { width: w, height: h } = img;
      if (!w || !h) { reject(new Error('图片读取失败')); return; }
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';            // PNG 转 JPEG 时透明区会变黑，先铺白底
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const outType = keepPng ? 'image/png' : 'image/jpeg';
      cv.toBlob((blob) => {
        if (!blob) { reject(new Error('图片压缩失败')); return; }
        const ext = keepPng ? 'png' : 'jpg';
        resolve({ blob, ext, width: w, height: h });
      }, outType, keepPng ? undefined : 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
function imgObjectName(ext) {
  const rand = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `${user.id}/${Date.now()}-${rand}.${ext}`;
}
// 传完拿回 { path, url }：path 留着给「删记录时同步删文件」用
async function uploadImage(file) {
  const { blob, ext, width, height } = await compressImage(file);
  const path = imgObjectName(ext);
  const { error } = await sb.storage.from(IMG_BUCKET).upload(path, blob, {
    contentType: blob.type, upsert: false,
  });
  if (error) throw new Error(error.message || '上传失败');
  const { data } = sb.storage.from(IMG_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl, w: width, h: height, size: blob.size };
}
function publicUrlOf(path) {
  if (!path) return '';
  try { return sb.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
}
// 删记录 / 删图片时清存储桶。失败只提示，不阻断主流程（记录已经删掉了，图片属于残留）
async function removeImageFiles(paths) {
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length) return;
  const { error } = await sb.storage.from(IMG_BUCKET).remove(list);
  if (error) toast('图片文件清理失败：' + error.message, 'error');
}
// 保存成功后清理被移除的图片：原记录里有、这次表单里没有的，文件一并删掉，避免留孤儿文件
async function removeStaleImages(beforePaths, imgsNow) {
  const keep = new Set((imgsNow || []).map(x => x && x.path).filter(Boolean));
  const gone = (beforePaths || []).filter(p => p && !keep.has(p));
  if (gone.length) await removeImageFiles(gone);
}
function imgsOf(rec) {
  return Array.isArray(rec && rec.remark_images) ? rec.remark_images.filter(x => x && x.path) : [];
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

// ---------- 日期框：点进去还空着就直接补今天 ----------
// 手动清空的阶段记在 dateSkip 里，否则「清除」按钮会没用（下次点又自动填回来）
const dateSkip = new Set();
function dateSkipKey(el) {
  if (el.dataset.dp) return 'dp:' + el.dataset.dp;
  if (el.dataset.sds) return 'sds:' + el.dataset.sds;
  if (el.dataset.gf === 'date') return 'gf:' + el.dataset.uk;
  return '';
}
// 返回补上的日期；已经有值 / 用户清空过 / 不是日期框 → 返回 ''
function focusFillDate(el) {
  if (!el) return '';
  if (el.value && el.value.trim()) return '';
  if (dateSkip.has(dateSkipKey(el))) return '';
  const t = todayStr();
  el.value = t;
  // 选中年份，想改就直接覆写这段数字，不用从头删
  if (el.setSelectionRange) { try { el.setSelectionRange(0, 4); } catch (_) { /* type=date 不支持选区，忽略 */ } }
  el.classList.add('just-today');
  setTimeout(() => el.classList.remove('just-today'), 1200);
  return t;
}
// 补上的值要落到数据里，否则保存时丢
function commitFocusDate(el, t) {
  if (el.dataset.dp) {
    draftDates[el.dataset.dp] = t;
    const derived = stageFromDates(draftDates);
    if (derived) draftStage = derived;
    renderEditStagesOnly();      // 只刷阶段 chip，不动日期行，输入框焦点保留
  } else if (el.dataset.gf === 'date') {
    const u = draftUnits.find(x => x.key === el.dataset.uk);
    if (u) u.date = t;
  }
  // 详情弹层不在这里写库：关弹层时统一落库（见 flushSheetDates），免得重建 DOM 打断输入
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

// ---------- toast ----------
// 三种语气：info（默认，深色）/ success（绿）/ error（红）。
// 错误停留更久，避免用户没看清就消失；成功 / 恢复这类要在 App 里被读到的事件用绿色。
let toastTimer = null;
function hideToast() {
  const el = $('#toast'); if (el) el.classList.add('hidden');
  const b = $('#toast-act'); if (b) { b.classList.add('hidden'); b.onclick = null; }
  clearTimeout(toastTimer);
}
function toast(msg, type) {
  const el = $('#toast'); if (!el) return;
  const act = $('#toast-act'); if (act) { act.classList.add('hidden'); act.onclick = null; }
  const t = type || 'info';
  $('#toast-msg').textContent = msg;
  el.className = 'toast ' + t;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, t === 'error' ? 3600 : 2200);
}
// 带操作按钮的 toast（目前用于「删除后撤销」）：按钮点完立即收起并执行回调
function toastAction(msg, label, onAct, ms) {
  const act = $('#toast-act');
  if (act) {
    act.textContent = label;
    act.classList.remove('hidden');
    act.onclick = () => { hideToast(); if (typeof onAct === 'function') onAct(); };
  }
  const el = $('#toast'); if (!el) return;
  $('#toast-msg').textContent = msg;
  el.className = 'toast info';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms || 6000);
}
// ---------- 启动兜底 ----------
// SDK / 网络异常时给一张可重试的卡片，不要留白屏让用户以为是 App 坏了
function showBootError(msg) {
  const boot = $('#view-boot');
  const root = $('#app-root'), auth = $('#view-auth');
  if (root) root.classList.add('hidden');
  if (auth) auth.classList.add('hidden');
  if (!boot) return;
  const m = $('#boot-msg'); if (m) m.textContent = msg;
  const b = $('#btn-retry'); if (b) b.classList.remove('hidden');
  boot.classList.remove('hidden');
}
function hideBoot() {
  const boot = $('#view-boot'); if (boot) boot.classList.add('hidden');
}

// ---------- 覆盖层与返回键 ----------
// 详情弹层 / 编辑页都是覆盖在主内容之上的浮层。若不进历史栈，安卓返回键会直接退出整个 App。
// 约定：同一时刻只有一层覆盖；打开时 pushState，关闭时 history.back()，popstate 里做真正的收尾。
let overlayKind = null;   // 'sheet' | 'edit' | null

function overlayOpen(kind) {
  if (overlayKind === kind) return;
  const replace = !!overlayKind;   // 弹层里直接跳编辑：把这条记录换成编辑，避免返回一次又回到已关掉的弹层
  overlayKind = kind;
  try { history[replace ? 'replaceState' : 'pushState']({ duotou: kind }, ''); }
  catch (e) { /* 不支持 history API 的浏览器：覆盖层照用，只是返回键会直接退出 */ }
}
// 用户主动关闭（点遮罩 / Esc / 取消按钮）：先同步摘掉标记再回退历史，
// 这样紧跟着的 back 不会再触发一次 popstate 处理
function overlayDismiss() {
  if (!overlayKind) return false;
  const kind = overlayKind;
  overlayKind = null;
  if (kind === 'sheet') closeSheet();
  try { history.back(); } catch (e) { /* 忽略 */ }
  return true;
}
// 返回键触发的收尾：浏览器已经帮我们退了一格，这里不要再 history.back()，
// 否则会在 popstate 里再退一次，一路退出应用（编辑页尤其明显）。
function closeOverlayByBack() {
  const kind = overlayKind;
  if (!kind) return;
  overlayKind = null;
  if (kind === 'sheet') { closeSheet(); return; }
  editingId = null;
  draftGroup = '';
  draftMode = 'single';
  showView('feed');
}
// 用户点「取消」：主动关，得自己退掉那条历史
function cancelEdit() {
  closeOverlayByBack();
  try { history.back(); } catch (e) { /* 忽略 */ }
}

// ---------- 视图切换 ----------
function showView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-auth').classList.add('hidden');
  $('#app-root').classList.remove('hidden');
  hideBoot();
  closeSheet();
  overlayKind = null;   // 已经切走了，覆盖层的栈标记一并清掉，别让返回键去关一个不存在的弹层
  const map = { feed: '#view-feed', search: '#view-search', account: '#view-account', edit: '#view-edit' };
  if (map[name]) $(map[name]).classList.remove('hidden');
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.nav === name));
  if (name === 'feed') renderFeed();
  if (name === 'search') renderSearch();
  if (name === 'account') renderAccount();
  if (name === 'edit') renderEdit();
}

// 进入编辑页的统一入口：所有跳转都经过这里，保证编辑页一定在历史栈里
function openEditView(opts) {
  opts = opts || {};
  editingId = opts.id || null;
  draftGroup = opts.group || '';
  draftMode = opts.mode || 'single';
  // 从弹层直接跳过来时覆盖层还是 sheet，overlayOpen 会把它替换成 edit（而不是再压一层）
  if (overlayKind === 'sheet') closeSheet();
  showView('edit');
  overlayOpen('edit');
}
// 编辑页返回列表：把历史条目一起弹掉，否则返回键要按两次
function cancelEdit() {
  if (overlayKind === 'edit') {
    overlayKind = null;
    try { history.back(); } catch (e) { /* 忽略 */ }
  }
  editingId = null;
  draftGroup = '';
  draftMode = 'single';
  showView('feed');
}
// 保存成功后回到列表，同样要把编辑页那条历史弹掉（此时编辑页的 DOM 已被 showView 换掉）
function leaveEditState() {
  if (overlayKind !== 'edit') return;
  overlayKind = null;
  try { history.back(); } catch (e) { /* 忽略 */ }
}

// ---------- 认证 ----------
async function initAuth() {
  try {
    await doInitAuth();
  } catch (e) {
    console.error('[boot]', e);
    showBootError('初始化失败：' + ((e && e.message) || e));
  }
}
async function doInitAuth() {
  if (window.__sdkFailed || typeof window.supabase === 'undefined') {
    // SDK 没加载出来：此时 config.js 里再怎么配也没用，直接给可重试的提示
    showBootError('云端组件加载失败');
    return;
  }
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
    hideBoot();
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

// 列表三态：拉取中 / 成功（可能为空） / 失败。区分开，避免网络错误时被误读成「你还没有记录」
let loadState = 'idle';        // 'idle' | 'loading' | 'ok' | 'error'
let loadErrorMessage = '';
async function loadRecords() {
  loadState = 'loading';
  loadErrorMessage = '';
  try {
    const { data, error } = await sb.from('applications')
      .select('*').order('update_time', { ascending: false });
    if (error) throw new Error(error.message);
    records = (data || []).map(r => {
      const derived = stageFromDates(r.stage_dates);
      if (derived) r.stage = derived;
      return r;
    });
    loadState = 'ok';
  } catch (e) {
    loadState = 'error';
    loadErrorMessage = (e && e.message) || String(e);
  } finally {
    renderDatalists();
  }
}
// ---------- 输入候选 ----------
// 单位 / 二级单位 / 集团按键名做精确匹配，一个错别字就会分裂成两张卡。
// 这里把已有值喂给 datalist，让用户能直接选，从源头减少同音错字。
function renderDatalists() {
  const countMap = () => new Map();
  const tally = (map, v) => {
    const k = String(v || '').trim();
    if (!k) return;
    map.set(k, (map.get(k) || 0) + 1);
  };
  const fill = (id, map) => {
    const el = $(id); if (!el) return;
    const list = [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .slice(0, 80);
    el.innerHTML = list.map(([v]) => `<option value="${esc(v)}">`).join('');
  };
  const companies = countMap(), subs = countMap(), positions = countMap(), bases = countMap();
  for (const r of records) {
    tally(companies, r.company);
    tally(subs, r.sub_unit);
    tally(positions, r.position);
    const b = normalizeLocation(r.base);
    if (b) tally(bases, b);
  }
  fill('#company-list', companies);
  fill('#sub-list', subs);
  fill('#position-list', positions);
  fill('#base-list', bases);
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
  const groupTag = rec.group_name ? ('📁 ' + rec.group_name) : '';
  const bits = [groupTag, rec.position, rec.sub_unit, normBase].filter(Boolean).map(esc).join(' · ');
  const stageDate = rec.stage_dates && rec.stage_dates[rec.stage];
  const stageDateText = stageDate ? ` (${stageDate})` : '';

  return `<div class="rec" data-id="${rec.id}" role="button" tabindex="0">
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

// ---------- 集团分组 ----------
function groupNameOptions() {
  const set = new Set();
  for (const r of records) {
    const g = (r.group_name || '').trim();
    if (g) set.add(g);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}
// 集团「最新进展」= 进行中岗位里，最近活动时间最晚的那个岗位的阶段与日期
// 进行中 = 投递/测评/笔试/一面/二面/三面（不含 Offer 与 拒绝/放弃）；若无进行中则退而取全部
function groupProgress(recs) {
  const prog = recs.filter(r => STAGES.includes(r.stage) && r.stage !== 'Offer');
  const pool = prog.length ? prog : recs;
  let best = null, bestDate = '';
  for (const r of pool) {
    const last = r.stage_dates ? Object.values(r.stage_dates).sort().pop() : '';
    if (last && last > bestDate) { bestDate = last; best = r; }
  }
  return best ? { stage: best.stage, date: bestDate } : null;
}
// ---------- 单位身份与列表聚合 ----------
// 一条记录 = 一个「单位 × 岗位」。单位身份由 company + sub_unit 派生，不依赖新增字段，
// 因此历史数据不需要迁移（sub_unit 为空时单位键就等于公司名）。
function unitKey(r) { return (r.company || '') + '\u0000' + (r.sub_unit || ''); }
// 单位键含 NUL 分隔符，直接写进 HTML 属性会被浏览器替换成 U+FFFD，所以过一遍编码
function unitKeyAttr(key) { return encodeURIComponent(key); }
function unitLabel(recs) {
  const r = recs[0] || {};
  return String(r.sub_unit || '').trim() || r.company || '';
}
function lastActive(recs) {
  let best = 0;
  for (const r of recs) {
    const t = new Date(r.update_time || 0).getTime();
    if (t > best) best = t;
  }
  return best;
}
// 把记录折叠成卡片项：集团桶（≥2 条）→ 单位桶（≥2 条）→ 单卡。
// 卡片之间按「桶内最近活动时间」倒序，避免同一个单位/集团的记录被拆散或乱序。
function bucketize(list) {
  const groups = new Map(), units = new Map(), singles = [];
  for (const r of list) {
    const g = (r.group_name || '').trim();
    if (g) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); continue; }
    const k = unitKey(r);
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(r);
  }
  const items = [];
  for (const [g, recs] of groups) {
    if (recs.length >= 2) { items.push({ type: 'group', key: g, label: g, recs }); continue; }
    const k = unitKey(recs[0]);            // 集团只有一条 → 退化成按单位聚
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(recs[0]);
  }
  for (const [k, recs] of units) {
    if (recs.length >= 2) items.push({ type: 'unit', key: k, label: unitLabel(recs), recs });
    else singles.push({ type: 'single', key: String(recs[0].id), label: recs[0].company, recs });
  }
  items.push(...singles);
  items.sort((a, b) => lastActive(b.recs) - lastActive(a.recs));
  return items;
}
// 桶卡上的名称 chip：集团桶列出各单位，单位桶列出各岗位
function bucketChips(names, limit) {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length < 2) return '';
  const shown = uniq.slice(0, limit).map(n => `<span class="bucket-chip">${esc(n)}</span>`).join('');
  const rest = uniq.length > limit ? `<span class="bucket-chip more">+${uniq.length - limit}</span>` : '';
  return `<div class="bucket-chips">${shown}${rest}</div>`;
}
// 列表空位到底显示什么：拉取中 / 拉取失败 / 真的没数据（或没匹配）——三种情况文案不同
function listEmptyHTML(kind) {
  if (loadState === 'loading') {
    return `<div class="empty"><span class="spinner"></span><div class="big">正在加载…</div></div>`;
  }
  if (loadState === 'error') {
    return `<div class="empty err">
      <div class="big">加载失败</div>
      <div class="empty-msg">${esc(loadErrorMessage || '网络或服务异常')}</div>
      <button type="button" class="btn ghost retry" data-retry="1">重试</button>
    </div>`;
  }
  return kind === 'search'
    ? `<div class="empty">没有匹配的记录</div>`
    : `<div class="empty"><div class="big">还没有记录</div>点右下角 + 添加你的第一份投递</div>`;
}

// ---------- 首页 ----------
function renderFeed() {
  const err = loadState === 'error';
  const active = records.filter(r => STAGES.includes(r.stage) && r.stage !== 'Offer').length;
  const offers = records.filter(r => r.stage === 'Offer').length;
  const rejects = records.filter(r => TERMINAL.includes(r.stage)).length;
  $('#stat-active').textContent = err ? '—' : active;
  $('#stat-offer').textContent = err ? '—' : offers;
  $('#stat-reject').textContent = err ? '—' : rejects;
  $('#stat-total').textContent = err ? '—' : records.length;
  $$('#feed-filters .chip').forEach(c => c.classList.toggle('on', c.dataset.filter === feedFilter));

  const items = bucketize(feedFiltered());
  const shown = items.slice(0, feedShown);
  $('#feed-list').innerHTML = shown.length
    ? shown.map(bucketCardHTML).join('')
    : listEmptyHTML('feed');
  setMoreBtn('#feed-more', shown.length, items.length);
}
function bucketCardHTML(item) {
  if (item.type === 'single') return recCardHTML(item.recs[0]);
  const recs = item.recs;
  const gp = groupProgress(recs) || { stage: '投递', date: '' };
  const color = COLORS[gp.stage] || '#2B6CFF';
  const dateTxt = gp.date ? ` · 最近 ${esc(gp.date)}` : '';
  if (item.type === 'group') {
    const unitN = new Set(recs.map(unitKey)).size;
    const names = recs.map(r => String(r.sub_unit || '').trim() || r.company);
    return `<div class="rec group" data-group="${esc(item.label)}" role="button" tabindex="0">
      <div class="rec-top">
        <div class="rec-title">${esc(item.label)}</div>
        <span class="g-badge">${unitN} 个单位 · ${recs.length} 个岗位</span>
      </div>
      <div class="g-agg">最新进展：<strong style="color:${color}">${esc(gp.stage)}</strong>${dateTxt}</div>
      ${bucketChips(names, 4)}
      <div class="rec-foot"><span class="rec-meta">点按查看各单位与岗位</span><span class="rec-badge">›</span></div>
    </div>`;
  }
  const posNames = recs.map(r => String(r.position || '').trim());
  return `<div class="rec group" data-unit="${unitKeyAttr(item.key)}" role="button" tabindex="0">
    <div class="rec-top">
      <div class="rec-title">${esc(item.label)}</div>
      <span class="g-badge">${recs.length} 个岗位</span>
    </div>
    <div class="g-agg">最新进展：<strong style="color:${color}">${esc(gp.stage)}</strong>${dateTxt}</div>
    ${bucketChips(posNames, 4)}
    <div class="rec-foot"><span class="rec-meta">点按查看该单位下的岗位</span><span class="rec-badge">›</span></div>
  </div>`;
}
// 列表底部的「加载更多」：还有未展示项时才出现
function setMoreBtn(sel, shownN, totalN) {
  const el = $(sel); if (!el) return;
  if (totalN > shownN) {
    el.classList.remove('hidden');
    el.textContent = `加载更多（已显示 ${shownN} / ${totalN}）`;
  } else {
    el.classList.add('hidden');
  }
}
// 滑到底自动加载：把「加载更多」按钮当哨兵，它进入视口就点它，复用上面的点击处理（同一套分页逻辑）。
// 这两个按钮是静态元素，不随列表 innerHTML 重渲染，所以只需观察一次；全部加载完按钮 hidden，观察器不再触发。
function setupAutoLoadMore() {
  if (!('IntersectionObserver' in window)) return;   // 老浏览器没有这个 API，仍可手动点按钮
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      if (el.classList.contains('hidden')) return;   // 已全部加载完
      el.click();
    });
  }, { rootMargin: '240px 0px' });                  // 提前 240px 触发，滚到底时内容已就位
  ['#feed-more', '#search-more'].forEach(sel => { const el = $(sel); if (el) io.observe(el); });
}

function feedFiltered() {
  if (feedFilter === 'all') return records;
  if (feedFilter === 'active') return records.filter(r => STAGES.includes(r.stage) && r.stage !== 'Offer');
  if (feedFilter === 'Offer') return records.filter(r => r.stage === 'Offer');
  if (feedFilter === 'reject') return records.filter(r => TERMINAL.includes(r.stage));
  return records;
}

// ---------- 搜索 ----------
// 五个筛选条件：关键字（全字段）/ 阶段 / 单位 / 岗位 / Base；单位与岗位为独立子串匹配
function filteredRecords() {
  const kw = searchState.kw.trim().toLowerCase();
  const base = searchState.base.trim().toLowerCase();
  const unit = searchState.unit.trim().toLowerCase();
  const pos = searchState.position.trim().toLowerCase();
  const list = records.filter(r => {
    const normB = normalizeLocation(r.base);
    if (searchState.stage !== '全部' && r.stage !== searchState.stage) return false;
    if (base && !([r.base, normB].some(x => (x || '').toLowerCase().includes(base)))) return false;
    if (unit && !([r.company, r.sub_unit, r.group_name].some(x => (x || '').toLowerCase().includes(unit)))) return false;
    if (pos && !String(r.position || '').toLowerCase().includes(pos)) return false;
    if (kw) {
      const hay = [r.company, r.sub_unit, r.position, r.remark, r.base, normB, r.group_name].map(x => (x || '').toLowerCase()).join(' ');
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  return sortRecords(list);
}
// 排序：最近更新（默认）/ 投递日期（空值排最后）/ 阶段进度（终态排最后）
function sortRecords(list) {
  const t = r => new Date(r.update_time || 0).getTime() || 0;
  const out = [...list];
  if (searchState.sort === 'apply') {
    out.sort((a, b) => String(b.apply_date || '').localeCompare(String(a.apply_date || '')) || t(b) - t(a));
  } else if (searchState.sort === 'stage') {
    const rank = r => (STAGES.includes(r.stage) ? STAGES.indexOf(r.stage) : -1);
    out.sort((a, b) => rank(b) - rank(a) || t(b) - t(a));
  } else {
    out.sort((a, b) => t(b) - t(a));
  }
  return out;
}
function renderSearch() {
  const stageChips = ['全部', ...ALL_STAGES].map(s =>
    `<span class="chip ${searchState.stage === s ? 'on' : ''}" data-stage="${s}" role="button" tabindex="0" aria-pressed="${searchState.stage === s}">${s}</span>`).join('');
  $('#search-stages').innerHTML = stageChips;
  const list = filteredRecords();
  const unitN = new Set(list.map(unitKey)).size;
  $('#search-count').textContent = `命中 ${list.length} 条记录 · 涉及 ${unitN} 个单位`;
  const hasFilter = !!(searchState.kw || searchState.unit || searchState.position
    || searchState.base || searchState.stage !== '全部');
  $('#search-clear').classList.toggle('hidden', !hasFilter);

  // 结果同样按「集团 / 单位」聚合展示，与首页保持一致
  const items = bucketize(list);
  const shown = items.slice(0, searchShown);
  $('#search-list').innerHTML = shown.length
    ? shown.map(bucketCardHTML).join('')
    : `<div class="empty">没有匹配的记录</div>`;
  setMoreBtn('#search-more', shown.length, items.length);
}

// ---------- 编辑 ----------
function renderEdit() {
  const rec = editingId ? records.find(r => r.id === editingId) : null;
  $('#edit-title').textContent = rec ? '编辑投递' : '添加投递';
  $('#btn-delete').classList.toggle('hidden', !rec);
  // 集团名：编辑时取原值；新增时若从集团弹层「在此集团下新增」进入，则带入该集团名
  const initGroup = rec ? (rec.group_name || '') : (draftGroup || '');
  // 「单个单位 + 集团名称」写出来的记录：单位名称与集团名不同（company 保留了真实单位名），
  // 编辑时回到单个单位模式，避免被集团模式覆写成 group 名
  const singleTagged = !!(rec && initGroup && rec.company && rec.company !== rec.group_name);
  draftMode = (initGroup && !singleTagged) ? 'group' : 'single';
  setModeUI(draftMode);
  // 集团模式：编辑时这条记录成为一张单位卡（一个岗位）；老数据 company 可能是全称（如 中信银行北京市分行），回填到具体单位
  if (draftMode === 'group') {
    draftUnits = rec
      ? [{
          key: nextKey('u'), recId: rec.id,
          sub: rec.sub_unit || (rec.company !== rec.group_name ? rec.company : '') || '',
          date: (rec.stage_dates && rec.stage_dates['投递']) || '',
          // 岗位带上原记录 id：保存时这条走 update，本次新增的岗位行走 insert
          positions: [{ key: nextKey('p'), recId: rec.id, name: rec.position || '', base: rec.base || '', remark: rec.remark || '', imgs: imgsOf(rec) }],
        }]
      : [newUnit()];
    // 编辑已有记录：保留其原有各阶段日期，保存时与行内投递日期合并；新增则从空开始
    groupEditStageDates = rec && rec.stage_dates ? { ...rec.stage_dates } : null;
    groupEditStage = rec ? (rec.stage || '投递') : '投递';
  } else {
    // 单个单位模式：单位 / 链接 / 日期在外层共用字段上；Base / 备注挂在岗位行里，这里只需要装岗位
    draftUnits = [{
      key: nextKey('u'), recId: rec ? rec.id : null,
      positions: [{ key: nextKey('p'), recId: rec ? rec.id : null, name: rec ? (rec.position || '') : '', base: rec ? (rec.base || '') : '', remark: rec ? (rec.remark || '') : '', imgs: rec ? imgsOf(rec) : [] }],
    }];
    groupEditStageDates = null;
    groupEditStage = '投递';
  }
  renderUnits();
  renderPositions(draftUnits[0], $('#single-positions'));
  $('#f-group').value = initGroup;
  $('#f-group-single').value = singleTagged ? initGroup : (draftMode === 'single' ? initGroup : '');
  $('#group-list').innerHTML = groupNameOptions().map(g => `<option value="${esc(g)}">`).join('');
  $('#f-company').value = rec ? rec.company : '';
  $('#f-sub').value = rec ? (rec.sub_unit || '') : '';
  // 批量粘贴入口复位
  setBatchMode(false);
  $('#f-link').value = rec ? (rec.link || '') : '';
  draftDates = rec && rec.stage_dates ? { ...rec.stage_dates }
    : (rec ? {} : { '投递': todayStr() });   // 新增时默认「投递」日为今天
  draftStage = stageFromDates(draftDates) || (rec ? rec.stage : '投递');
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}" role="button" tabindex="0">${s}</span>`).join('');
  renderDateRows();
  // 每次进入编辑页都把行内错误与日期折叠区复位
  clearAllErrors();
  $('#dates-toggle').setAttribute('aria-expanded', 'false');
  $('#edit-dates').classList.add('hidden');
  updateGroupHint();
}
// 单个单位 / 集团投递 模式切换（两套表单字段不同）
// 集团模式下：投递日在单位卡里填；Base 地 / 备注只按岗位填；阶段与各阶段日期区不适用（各条记录在详情里推进）
function setModeUI(mode) {
  draftMode = mode;
  const isGroup = mode === 'group';
  document.querySelectorAll('#f-mode .seg-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#form-card').classList.toggle('mode-single', !isGroup);
  $('#form-card').classList.toggle('mode-group', isGroup);
  $('#mode-note').textContent = isGroup
    ? '一个集团，含多个单位；每个单位可填多个岗位，各自独立投递'
    : '一个单位，可填多个岗位；每个岗位生成一条记录';
  $('#single-fields').classList.toggle('hidden', isGroup);
  $('#group-fields').classList.toggle('hidden', !isGroup);
  // Base 地 / 备注已下放到岗位行：单模式没有整单字段，集团模式由单位卡默认值兜底
  $('#row-stage').classList.toggle('hidden', isGroup);
  $('#row-stage-group').classList.toggle('hidden', !isGroup);
  $('#row-dates').classList.toggle('hidden', isGroup);
  if (isGroup) {
    if (!draftUnits.length) draftUnits = [newUnit()];
    renderUnits();
  } else {
    renderPositions(draftUnits[0], $('#single-positions'));
  }
  updateUnitCount();
}
// 集团模式的单位卡：卡头（序号 + 删除）+ 两段（投递信息 / 该单位下的岗位）
function renderUnits() {
  $('#g-rows').innerHTML = draftUnits.map((u, i) => `
    <div class="u-card" data-uk="${u.key}">
      <div class="u-head">
        <span class="u-idx">单位 ${i + 1}</span>
        <button type="button" class="u-del" data-udel="${u.key}" ${draftUnits.length <= 1 ? 'hidden' : ''} aria-label="删除该单位">×</button>
      </div>
      <div class="u-body">
        <div class="u-sec">
          <div class="u-sec-title">投递信息</div>
          <label class="fld">
            <span class="fld-label">具体单位 / 分行</span>
            <input class="gr-sub" data-uk="${u.key}" data-gf="sub" placeholder="如 中信银行北京分行" value="${esc(u.sub || '')}">
          </label>
          <div class="u-line">
            <label class="fld date-fld">
              <span class="fld-label">投递日</span>
              <input class="gr-date" type="date" data-uk="${u.key}" data-gf="date" aria-label="投递日期" value="${esc(u.date || '')}">
            </label>
          </div>
        </div>
        <div class="u-sec">
          <div class="u-sec-title">该单位下的岗位<span class="u-pos-n" data-posn="${u.key}">（${u.positions.length}）</span></div>
          <div class="p-hint p-hint-sec">Base 地与备注按岗位填写，每个岗位各自独立</div>
          <div class="u-positions p-list" data-posof="${u.key}"></div>
          <button type="button" class="p-add" data-padd="${u.key}">＋ 添加岗位</button>
        </div>
      </div>
    </div>`).join('');
  for (const u of draftUnits) {
    renderPositions(u, $(`.u-positions[data-posof="${u.key}"]`));
  }
  updateUnitCount();
}
// 岗位行列表：集团模式下渲染在单位卡内，单个单位模式下渲染在外层岗位区
function renderPositions(unit, container) {
  if (!unit || !container) return;
  container.innerHTML = unit.positions.map((p, i) => `
    <div class="p-item">
      <div class="p-row">
        <span class="pi-idx">${i + 1}</span>
        <input class="pi-name" data-uk="${unit.key}" data-pk="${p.key}" maxlength="40"
               placeholder="如 AI 应用开发岗" aria-label="岗位名称 ${i + 1}" value="${esc(p.name || '')}">
        <button type="button" class="pi-del" data-uk="${unit.key}" data-pdel="${p.key}"
                ${unit.positions.length <= 1 ? 'hidden' : ''} aria-label="删除该岗位">×</button>
      </div>
      <div class="p-meta">
        <input class="pi-base" data-uk="${unit.key}" data-pk="${p.key}" data-pb="1" list="base-list" maxlength="30"
               placeholder="Base 地，如 成都 / 深圳" aria-label="岗位 ${i + 1} 的 Base 地" value="${esc(p.base || '')}">
        <input class="pi-remark" data-uk="${unit.key}" data-pk="${p.key}" data-pr="1" maxlength="120"
               placeholder="备注，如 邮箱投的 / 内推" aria-label="岗位 ${i + 1} 的备注" value="${esc(p.remark || '')}">
      </div>
      ${imgStripHTML(unit, p, i)}
    </div>`).join('');
  const addBtn = draftMode === 'single' ? $('#p-add-single') : $(`.p-add[data-padd="${unit.key}"]`);
  if (addBtn) {
    const full = unit.positions.length >= MAX_POSITIONS;
    addBtn.disabled = full;
    addBtn.textContent = full ? `最多 ${MAX_POSITIONS} 个岗位` : '＋ 添加岗位';
  }
  if (draftMode !== 'single') {
    const nEl = $(`.u-pos-n[data-posn="${unit.key}"]`);
    if (nEl) nEl.textContent = `（${unit.positions.length}）`;
  }
  updateUnitCount();
}
function findUnit(key) { return draftUnits.find(u => u.key === key); }
// 岗位行图片的点击分发：添加 / 删除 / 点开预览。两个岗位区共用。
function handleImgClick(e) {
  const add = e.target.closest('[data-imgadd]');
  if (add) { pickAndUploadImages(add.dataset.uk, add.dataset.pk); return true; }
  const del = e.target.closest('[data-imgdel]');
  if (del) { removePositionImage(del.dataset.uk, del.dataset.pk, Number(del.dataset.imgdel)); return true; }
  const img = e.target.closest('[data-preview]');
  if (img) { openImageViewer(img.dataset.preview); return true; }
  return false;
}
// 选图 → 逐张压缩上传。文件选择框按岗位缓存，第二次点同一个岗位时接着用
let imgPicker = null;
// 选图 → 逐张压缩上传。文件选择框全局一个，按岗位记录当前属于谁
function ensureImagePicker() {
  if (imgPicker) return imgPicker;
  imgPicker = document.createElement('input');
  imgPicker.type = 'file';
  imgPicker.accept = 'image/*';
  imgPicker.multiple = true;
  imgPicker.style.display = 'none';
  document.body.appendChild(imgPicker);
  // change 不冒泡，挂在 input 自身上
  imgPicker.addEventListener('change', () => {
    const files = imgPicker.files;
    if (!files || !files.length) return;
    const { uk, pk } = imgPicker.dataset;
    uploadPickedImages(files, uk, pk);
  });
  return imgPicker;
}
function pickAndUploadImages(uk, pk) {
  const u = findUnit(uk);
  const p = u && u.positions.find(x => x.key === pk);
  if (!p) return;
  const picker = ensureImagePicker();
  picker.dataset.uk = uk;
  picker.dataset.pk = pk;
  picker.value = '';        // 允许连续选同一张
  picker.click();
}
async function uploadPickedImages(files, uk, pk) {
  const u = findUnit(uk);
  const p = u && u.positions.find(x => x.key === pk);
  if (!p) return;
  p.imgs = p.imgs || [];
  const room = MAX_IMGS_PER_POS - p.imgs.length;
  if (room <= 0) { toast(`每个岗位最多 ${MAX_IMGS_PER_POS} 张图片`, 'error'); return; }
  const list = [...files].slice(0, room);
  if (files.length > room) toast(`超过上限，只上传前 ${room} 张`, 'error');
  toast(`正在上传 0 / ${list.length}…`);
  let done = 0, failed = 0;
  for (const f of list) {
    try {
      const im = await uploadImage(f);
      p.imgs.push(im);
      done++;
    } catch (err) { failed++; toast(String(err.message || err), 'error'); }
    toast(`正在上传 ${done + failed} / ${list.length}…`);
  }
  renderPositions(u, $(draftMode === 'single' ? '#single-positions' : `.u-positions[data-posof="${uk}"]`));
  if (done) toast(`已上传 ${done} 张图片`, 'success');
  if (done + failed === list.length && failed) toast(`${failed} 张上传失败`, 'error');
}
// 移除一张：先改内存，保存时若这条记录是 update，会把「原来有、现在没了」的文件删掉
function removePositionImage(uk, pk, idx) {
  const u = findUnit(uk);
  const p = u && u.positions.find(x => x.key === pk);
  if (!p || !p.imgs || !p.imgs[idx]) return;
  p.imgs.splice(idx, 1);
  renderPositions(u, $(draftMode === 'single' ? '#single-positions' : `.u-positions[data-posof="${uk}"]`));
}
// 点开看大图：详情弹层里复用同一个 viewer
let imgViewer = null;
function openImageViewer(src) {
  if (!src) return;
  if (!imgViewer) {
    imgViewer = document.createElement('div');
    imgViewer.className = 'img-viewer';
    imgViewer.innerHTML = '<img alt="备注图片"><button type="button" class="iv-x" aria-label="关闭">×</button>';
    document.body.appendChild(imgViewer);
    imgViewer.addEventListener('click', (e) => {
      if (e.target === imgViewer || e.target.closest('.iv-x')) closeImageViewer();
    });
  }
  imgViewer.querySelector('img').src = src;
  imgViewer.classList.remove('hidden');
}
function closeImageViewer() { if (imgViewer) imgViewer.classList.add('hidden'); }
function imgStripHTML(unit, p, i) {
  const imgs = p.imgs || [];
  const full = imgs.length >= MAX_IMGS_PER_POS;
  return `<div class="p-imgs">
    ${imgs.map((im, k) => `<span class="p-img">
      <img src="${esc(im.url || publicUrlOf(im.path))}" alt="备注图片 ${k + 1}" loading="lazy"
           data-preview="${esc(im.url || publicUrlOf(im.path))}">
      <button type="button" class="p-img-x" data-uk="${unit.key}" data-pk="${p.key}" data-imgdel="${k}"
              aria-label="删除这张图片">×</button>
    </span>`).join('')}
    ${full ? '' : `<button type="button" class="p-img-add" data-uk="${unit.key}" data-pk="${p.key}" data-imgadd="1"
       aria-label="给岗位 ${i + 1} 添加备注图片">＋ 图</button>`}
    ${imgs.length ? `<span class="p-img-tip">${imgs.length}/${MAX_IMGS_PER_POS}</span>` : ''}
  </div>`;
}
// 添加岗位：达上限置灰，重名拦截并把焦点移到已存在的那一行
function addPosition(unitKey) {
  const u = findUnit(unitKey); if (!u) return;
  if (u.positions.length >= MAX_POSITIONS) { toast(`最多 ${MAX_POSITIONS} 个岗位`); return; }
  u.positions.push(newPosition());
  rerenderPositions(u);
  const rows = positionsContainer(u).querySelectorAll('.pi-name');
  if (rows.length) rows[rows.length - 1].focus();
}
function removePosition(unitKey, posKey) {
  const u = findUnit(unitKey); if (!u) return;
  if (u.positions.length <= 1) return;
  const idx = u.positions.findIndex(p => p.key === posKey);
  if (idx < 0) return;
  const p = u.positions[idx];
  if (p.recId && !confirm('这个岗位已经保存过，删除会同时移除对应的投递记录，确定？')) return;
  u.positions.splice(idx, 1);
  rerenderPositions(u);
  const rows = positionsContainer(u).querySelectorAll('.pi-name');
  if (rows.length) rows[Math.max(0, idx - 1)].focus();
}
function positionsContainer(u) {
  return draftMode === 'single' ? $('#single-positions') : $(`.u-positions[data-posof="${u.key}"]`);
}
function rerenderPositions(u) {
  renderPositions(u, positionsContainer(u));
}
// 岗位名归一化后比较：去空白、全角转半角、忽略大小写
function posKeyOf(name) {
  return String(name || '').trim().replace(/\s+/g, '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}
function duplicatePosition(u, pos, name) {
  const k = posKeyOf(name);
  if (!k) return null;
  return u.positions.find(p => p !== pos && posKeyOf(p.name) === k) || null;
}
// 改岗位名：重名则提示并回滚输入框，不写入状态（避免整表重渲染丢焦点）
function editPositionName(u, posKey, value, inputEl) {
  const p = u.positions.find(x => x.key === posKey);
  if (!p) return;
  const dup = duplicatePosition(u, p, value);
  if (dup) {
    toast(`「${String(value).trim()}」已经添加过了`);
    if (inputEl) inputEl.value = p.name;
    return;
  }
  p.name = value;
  updateUnitCount();
}
// 岗位行内的 Base 地 / 备注：只改状态不重渲染，保留光标
function setPositionMeta(u, inputEl) {
  if (!u || !inputEl.dataset.pk) return false;
  const p = u.positions.find(x => x.key === inputEl.dataset.pk);
  if (!p) return false;
  if (inputEl.dataset.pb) { p.base = inputEl.value; return true; }
  if (inputEl.dataset.pr) { p.remark = inputEl.value; return true; }
  return false;
}
function removeUnit(unitKey) {
  if (draftUnits.length <= 1) return;
  const idx = draftUnits.findIndex(u => u.key === unitKey);
  if (idx < 0) return;
  const u = draftUnits[idx];
  const saved = u.positions.filter(p => p.recId).length;
  if (saved && !confirm(`该单位下有 ${saved} 条已保存的投递，删除会一并移除，确定？`)) return;
  draftUnits.splice(idx, 1);
  renderUnits();
}
// 本次表单会生成的记录条数：每个单位至少 1 条，岗位全空也算 1 条
function countRecords() {
  let n = 0;
  for (const u of draftUnits) n += Math.max(1, u.positions.length);
  return n;
}
function updateUnitCount() {
  const el = $('#g-count');
  const addU = $('#g-add');
  if (el && draftMode === 'group') {
    el.textContent = `共将创建 ${countRecords()} 条投递记录`;
    el.classList.remove('hidden');
  } else if (el) {
    el.classList.add('hidden');
  }
  if (addU) {
    const full = draftUnits.length >= MAX_UNITS;
    addU.disabled = full;
    addU.textContent = full ? `最多 ${MAX_UNITS} 个单位` : '＋ 再加一个单位';
  }
}

// 两处「集团名称」输入（集团模式 / 单个单位模式的选填项）通用：选了已有集团名时提示将自动归并
function updateGroupHint() {
  hintFor($('#f-group'), $('#group-hint'), draftMode === 'group');
  hintFor($('#f-group-single'), $('#group-hint-single'), draftMode === 'single');
}
function hintFor(input, hint, active) {
  if (!input || !hint) return;
  const v = input.value.trim();
  if (!active || !v) { hint.classList.add('hidden'); return; }
  const match = groupNameOptions().find(g => g === v);
  if (match) {
    const n = records.filter(r => (r.group_name || '').trim() === v).length;
    hint.textContent = `将归入已有集团「${v}」（已有 ${n} 个投递，会自动合并）`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}
function renderDateRows() {
  $('#edit-dates').innerHTML = ALL_STAGES.map(s => `
    <div class="date-row">
      <div class="date-name"><span class="date-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input type="date" class="date-picker" data-dp="${s}" data-skip="${dateSkip.has('dp:' + s) ? '1' : ''}" value="${draftDates[s] ? esc(draftDates[s]) : ''}">
      <div class="date-acts">
        <button type="button" class="date-act" data-today="${s}">今日</button>
        <button type="button" class="date-act" data-yesterday="${s}">昨天</button>
        <button type="button" class="date-act clear" data-clear="${s}">清除</button>
      </div>
    </div>`).join('');
  // 折叠标题上显示已填项数，不用展开就能看到有没有填
  const n = ALL_STAGES.filter(s => String(draftDates[s] || '').trim()).length;
  const meta = $('#dates-meta');
  if (meta) meta.textContent = n ? `已填 ${n} 项` : '未填写';
}
function collectForm() {
  const stage_dates = {};
  for (const s of ALL_STAGES) {
    const v = (draftDates[s] || '').trim();
    if (v) stage_dates[s] = v;
  }
  const derived = stageFromDates(stage_dates);
  // Base 地 / 备注按岗位走：collectForm 只管整单共用的字段（单位 / 二级单位 / 集团 / 链接 / 阶段 / 日期）
  return {
    company: $('#f-company').value.trim(),
    group_name: draftMode === 'group'
      ? ($('#f-group').value.trim() || null)
      : ($('#f-group-single').value.trim() || null),
    sub_unit: $('#f-sub').value.trim() || null,
    link: $('#f-link').value.trim() || null,
    stage: derived || draftStage || '投递',
    stage_dates,
    apply_date: stage_dates['投递'] || null,
    update_time: new Date().toISOString(),
  };
}
// 批量粘贴：把 textarea 里的多行岗位并入某个单位的岗位列表（先填已有的空行，再新增）
function mergePositionLines(u, text) {
  const lines = [...new Set(String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean))];
  let added = 0;
  for (const line of lines) {
    if (u.positions.length >= MAX_POSITIONS) { toast(`最多 ${MAX_POSITIONS} 个岗位`); break; }
    const empty = u.positions.find(p => !(p.name || '').trim());
    if (empty) { empty.name = line; added++; continue; }
    if (duplicatePosition(u, null, line)) continue;
    u.positions.push(newPosition(line));
    added++;
  }
  return added;
}
// 批量粘贴面板开关：只有一个入口（右上角按钮），展开时按钮文案变「收起」。
// 关闭时若框里还有内容就先并入岗位列表再收起，避免内容被丢掉。
function setBatchMode(on, opts) {
  const btn = $('#f-pos-batch'), box = $('#batch-box'), ta = $('#f-position-multi');
  if (!btn || !box || !ta) return;
  if (!on && opts && opts.merge && ta.value.trim()) {
    const u = draftUnits[0];
    if (u) {
      const full = u.positions.length >= MAX_POSITIONS;   // 满了的话 mergePositionLines 内部已提示过
      const added = mergePositionLines(u, ta.value);
      rerenderPositions(u);
      if (added) toast(`已并入 ${added} 个岗位`);
      else if (!full) toast('没有新增：这些岗位已经在列表里');
    }
  }
  ta.value = '';
  btn.dataset.on = on ? '1' : '0';
  btn.classList.toggle('on', on);
  btn.textContent = on ? '收起' : '批量粘贴';
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  box.classList.toggle('hidden', !on);
  // 展开时收起「＋ 添加岗位」，避免两个虚线框上下叠着
  const addBtn = $('#p-add-single');
  if (addBtn) addBtn.classList.toggle('hidden', on);
}
// ---------- 行内校验 ----------
// 必填未过时：输入框标红 + 字段下方留一行错误文案 + toast 摘要 + 滚到该字段。
// toast 2.2 秒会消失，行内文案不会，用户滚到别处也能看到是哪一项错了。
function markError(inputSel, errSel, msg) {
  const inp = $(inputSel), err = $(errSel);
  if (inp) inp.classList.add('err');
  if (err) { err.textContent = msg; err.classList.remove('hidden'); }
  return inp;
}
function clearError(inputSel, errSel) {
  const inp = $(inputSel), err = $(errSel);
  if (inp) inp.classList.remove('err');
  if (err) { err.classList.add('hidden'); err.textContent = ''; }
}
function clearAllErrors() {
  clearError('#f-company', '#err-company');
  clearError('#f-group', '#err-group');
  for (const sel of ['#err-units', '#err-positions']) {
    const el = $(sel); if (el) { el.classList.add('hidden'); el.textContent = ''; }
  }
}
function failField(inputSel, errSel, msg) {
  clearAllErrors();
  const inp = markError(inputSel, errSel, msg);
  toast(msg);
  if (inp && inp.focus) {
    inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
    inp.focus({ preventScroll: true });
  }
}

// 保存入口：包一层「保存中…」禁用，避免慢网络下连点重复提交
async function saveRecord() {
  const btn = $('#btn-save');
  if (btn.disabled) return;
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    if (draftMode === 'group') await doSaveGroupRecord();
    else await doSaveSingleRecord();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}
// 单个单位保存：岗位列表展开成多条；第一条（若已存在）走 update，其余 insert
async function doSaveSingleRecord() {
  setBatchMode(false, { merge: true });   // 批量粘贴框还开着就先并入，避免内容没进列表就被保存掉
  const beforeImgs = editingId ? imgsOf(records.find(r => r.id === editingId)).map(x => x.path) : [];
  const base = collectForm();
  if (!base.company) { failField('#f-company', '#err-company', '请填写单位名称'); return; }
  const u = draftUnits[0] || newUnit();
  // 每个岗位一条记录：Base 地 / 备注取自该岗位自己的输入框，岗位全空也生成 1 条（只投单位不明岗位）
  const list = [];
  const seen = new Set();
  for (const p of u.positions) {
    const name = (p.name || '').trim();
    if (name) {
      const k = posKeyOf(name);
      if (seen.has(k)) continue;          // 同一单位下重名岗位只留一条，与批量粘贴的去重口径一致
      seen.add(k);
    }
    list.push({
      name: name || null,
      base: normalizeLocation(p.base || '') || null,
      remark: (p.remark || '').trim() || null,
      imgs: p.imgs || [],
    });
  }
  if (!list.length) list.push({ name: null, base: null, remark: null, imgs: [] });
  if (list.length > MAX_RECORDS) { toast(`一次最多提交 ${MAX_RECORDS} 条投递，请分批添加`); return; }
  let error = null, n = 0;
  if (editingId) {
    const first = list[0];
    const r = await sb.from('applications').update({ ...base, position: first.name, base: first.base, remark: first.remark, remark_images: first.imgs }).eq('id', editingId);
    error = r.error; n = 1;
    const rest = list.slice(1);
    if (!error && rest.length) {
      const r2 = await sb.from('applications').insert(rest.map(x => ({ ...base, position: x.name, base: x.base, remark: x.remark, remark_images: x.imgs })));
      error = r2.error; n += rest.length;
    }
  } else {
    const r = await sb.from('applications').insert(list.map(x => ({ ...base, position: x.name, base: x.base, remark: x.remark, remark_images: x.imgs })));
    error = r.error; n = list.length;
  }
  if (error) { toast('保存失败：' + error.message, 'error'); return; }
  if (editingId) await removeStaleImages(beforeImgs, list[0] && list[0].imgs);
  const gName = base.group_name;
  toast(gName
    ? (n > 1 ? `已添加 ${n} 条投递，归入「${gName}」` : `已保存，归入「${gName}」`)
    : (n > 1 ? `已添加 ${n} 条投递` : '已保存'));
  editingId = null;
  draftGroup = '';
  await loadRecords();
  showView('feed');
}
// 集团投递保存：集团名必填；每个单位下的每个岗位展开成一条记录（company=集团名、sub_unit=具体单位）。
// 投递日按单位填写（不同单位时间线不同）、链接全单共用；Base 地 / 备注只按岗位单独填；
// 岗位带 recId（编辑已有记录）走 update，新增的岗位走 insert
async function doSaveGroupRecord() {
  const beforeImgs = new Map();
  for (const u of draftUnits) for (const p of u.positions || []) {
    if (p.recId) beforeImgs.set(p.recId, imgsOf(records.find(r => r.id === p.recId)).map(x => x.path));
  }
  const group = $('#f-group').value.trim();
  if (!group) { failField('#f-group', '#err-group', '请填写集团名称'); return; }
  const link = $('#f-link').value.trim() || null;
  // 编辑时保留该记录原有的 company（可能来自「单个单位 + 集团名称」，是真实单位名，不等于集团名）
  const keptCompany = editingId ? (records.find(r => r.id === editingId) || {}).company : null;
  const payload = [];
  for (const u of draftUnits) {
    const sub = (u.sub || '').trim();
    const posList = u.positions.length ? u.positions : [{ recId: u.recId, name: '' }];
    for (const p of posList) {
      const name = (p.name || '').trim();
      if (!sub && !name) continue;   // 整张卡都没填 → 跳过
      const isEdit = !!p.recId;
      const stage_dates = isEdit ? { ...(groupEditStageDates || {}) } : {};
      if (u.date) stage_dates['投递'] = u.date; else delete stage_dates['投递'];
      const stage = stageFromDates(stage_dates) || (isEdit ? groupEditStage : '投递');
      payload.push({
        id: p.recId || null,
        company: (isEdit && keptCompany && keptCompany !== group) ? keptCompany : group,
        group_name: group,
        sub_unit: sub || null,
        position: name || null,
        // Base 地 / 备注只按岗位写，单位卡不再有默认值
        base: normalizeLocation(p.base) || null,
        link,
        remark: (p.remark || '').trim() || null,
        remark_images: p.imgs || [],
        stage,
        stage_dates,
        apply_date: stage_dates['投递'] || null,
        update_time: new Date().toISOString(),
      });
    }
  }
  // 编辑模式把单位/岗位清空了：保留集团主体这条记录，避免整条消失
  if (!payload.length && editingId) {
    const stage_dates = { ...(groupEditStageDates || {}) };
    payload.push({
      id: editingId, company: keptCompany || group, group_name: group, sub_unit: null, position: null,
      base: null, link, remark: null, stage: groupEditStage || '投递', stage_dates,
      apply_date: stage_dates['投递'] || null, update_time: new Date().toISOString(),
    });
  }
  if (!payload.length) { failField('#g-rows', '#err-units', '请至少填写一个单位或岗位'); return; }
  if (payload.length > MAX_RECORDS) { toast(`一次最多提交 ${MAX_RECORDS} 条投递，请分批添加`); return; }

  const updates = payload.filter(p => p.id);
  const inserts = payload.filter(p => !p.id).map(({ id, ...rest }) => rest);
  let error = null;
  for (const p of updates) {
    const { id, ...rest } = p;
    const r = await sb.from('applications').update(rest).eq('id', id);
    if (r.error) { error = r.error; break; }
  }
  if (!error && inserts.length) {
    const r = await sb.from('applications').insert(inserts);
    if (r.error) error = r.error;
  }
  if (error) { toast('保存失败：' + error.message, 'error'); return; }
  for (const p2 of updates) {
    const before = beforeImgs.get(p2.id) || [];
    await removeStaleImages(before, p2.remark_images);
  }
  toast(editingId ? '已保存' : (payload.length > 1 ? `已添加 ${payload.length} 条投递` : '已保存'), 'success');
  editingId = null;
  draftGroup = '';
  await loadRecords();
  showView('feed');
}
// 删除后给一次后悔机会：删之前把行内容留一份快照，撤销时原样写回。
// 不复用原 id（id 是 identity 列，显式写入会报错），但 update_time 一并带回去，排序位置不变。
const WRITE_FIELDS = ['company','group_name','base','sub_unit','position','link','remark','remark_images',
  'stage','stage_dates','apply_date','update_time'];
let lastDeleted = null;

async function deleteRecord(id) {
  id = id || editingId;
  if (!id) return;
  const row = records.find(r => r.id === id);
  if (!confirm('确定删除这条投递记录？')) return;
  const { error } = await sb.from('applications').delete().eq('id', id);
  if (error) { toast('删除失败：' + error.message, 'error'); return; }
  // 记录已删，图片留着就是孤儿文件，跟着删（失败只提示，不影响撤销）
  await removeImageFiles(imgsOf(row).map(x => x.path));
  lastDeleted = row || null;
  toastAction(`已删除「${row ? (row.company || '未命名') : ''}」`, '撤销', restoreDeleted, 6000);
  editingId = null;
  closeSheet();
  await loadRecords();
  showView('feed');
}
async function restoreDeleted() {
  const row = lastDeleted;
  lastDeleted = null;
  if (!row) return;
  const payload = {};
  for (const f of WRITE_FIELDS) if (row[f] !== undefined) payload[f] = row[f];
  const { error } = await sb.from('applications').insert(payload);
  if (error) { toast('恢复失败：' + error.message, 'error'); return; }
  await loadRecords();
  toast('已恢复', 'success');
  if (currentView === 'feed') showView('feed');
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
  overlayOpen('sheet');   // 进入历史栈，返回键可关掉弹层而不是退出应用
}
// 详情弹层：点日期框自动补的今天没走 change，关弹层前统一落库，避免白填
function flushSheetDates() {
  if (!sheetId) return;
  const inp = document.querySelector('#sheet-body [data-sds]');
  if (!inp) return;
  const rec = records.find(r => r.id === sheetId);
  if (!rec) return;
  // 先把整张弹层的日期读成一份新对象，再和库里对比；
  // 有差异才写一次，否则关一次弹层会按行数发 N 次更新。
  const next = {};
  document.querySelectorAll('#sheet-body [data-sds]').forEach((el) => {
    const v = parseDate(String(el.value || '').trim());
    if (v) next[el.dataset.sds] = v;
  });
  const cur = rec.stage_dates || {};
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)]);
  let changed = false;
  for (const k of keys) { if ((cur[k] || '') !== (next[k] || '')) { changed = true; break; } }
  if (!changed) return;
  const derived = stageFromDates(next);
  patchSheetDates(sheetId, next, derived ? ('已记录 · 当前阶段：' + derived) : '已保存日期');
}
function closeSheet() {
  flushSheetDates();
  sheetId = null;
  $('#sheet').classList.add('hidden');
}
// 弹层里的岗位行：岗位名 + Base（可选再带集团）+ 阶段 pill + 该阶段最近日期
// 弹层里的岗位行：紧凑进度条（只画节点与连线，不写阶段文字，窄行才放得下）
// + 「当前阶段（日期）· 更新于」，和列表单卡的 rec-foot 同一套信息
// unitTag：只有 1 个岗位时把单位名并进卡片，省掉一层「单位标题 + 卡片」的重复结构
function posRowHTML(r, showGroup, unitTag) {
  const rc = COLORS[r.stage] || '#9AA0A6';
  const latest = r.stage_dates && r.stage_dates[r.stage];
  const normBase = normalizeLocation(r.base);
  const city = shortCity(normBase);
  // 单位名里已经带了 Base 所在城市（如「深圳分公司」+「广东省深圳市」）就不再重复显示
  const showBase = !(unitTag && city && unitTag.includes(city));
  const detail = [showBase ? normBase : '', showGroup ? r.group_name : null].filter(Boolean).map(esc).join(' · ');
  const stageDateText = latest ? `（${esc(latest)}）` : '';
  return `<div class="g-child-row" data-child="${r.id}" role="button" tabindex="0">
    <div class="g-child-main">
      <div class="g-child-name">${esc(r.position || '未填岗位')}${r.link ? ' <span class="rec-badge">🔗</span>' : ''}</div>
      ${(unitTag || detail) ? `<div class="g-child-sub">${unitTag ? `<span class="g-child-tag">${esc(unitTag)}</span>` : ''}${detail}</div>` : ''}
      ${pipelineMiniHTML(r)}
      <div class="g-child-foot">当前：<strong style="color:${rc}">${esc(r.stage)}</strong>${stageDateText} · 更新于 ${relTime(r.update_time) || '—'}</div>
    </div>
    <div class="g-child-right">
      <span class="pill" style="background:${rc}">${esc(r.stage)}</span>
    </div>
  </div>`;
}
// 「广东省深圳市」→ 「深圳」，用于判断单位名里是否已含该城市
function shortCity(base) {
  const s = String(base || '');
  const afterProv = s.includes('省') ? s.split('省').pop() : s;
  return afterProv.replace(/市$/, '');
}
// 紧凑版流程条：与 pipelineHTML 同一套节点/连线算法，去掉阶段文字
function pipelineMiniHTML(rec) {
  const curStage = rec.stage || '投递';
  const isTerm = TERMINAL.includes(curStage);
  let curIdx = STAGES.indexOf(curStage);
  if (isTerm) {
    // 终态不在流程内，按 stage_dates 里已记录的流程阶段推断走到哪一步（取最靠后的那个）
    const reached = Object.keys(rec.stage_dates || {}).filter(s => STAGES.indexOf(s) >= 0)
      .sort((a, b) => STAGES.indexOf(b) - STAGES.indexOf(a));
    curIdx = reached.length ? STAGES.indexOf(reached[0]) : -1;
  }
  const termColor = COLORS[curStage] || '#9AA0A6';
  const color = isTerm ? termColor : (COLORS[curStage] || '#2B6CFF');
  const dots = STAGES.map((s, i) => {
    const isCurrent = !isTerm && s === curStage;
    const isStop = isTerm && i === curIdx;          // 终止在这一步
    const isPast = curIdx >= 0 && i < curIdx;
    const sColor = COLORS[s] || '#2B6CFF';
    let style = '';
    if (isStop) style = `background:${termColor};border-color:${termColor};box-shadow:0 0 0 2px ${termColor}33;`;
    else if (isCurrent) style = `background:${sColor};border-color:${sColor};box-shadow:0 0 0 2px ${sColor}33;`;
    else if (isPast) style = `background:${sColor};border-color:${sColor};`;
    return `<span class="pm-dot${isCurrent ? ' cur' : ''}${isStop ? ' stop' : ''}" style="${style}"></span>`;
  }).join('');
  return `<div class="pmini">
    <span class="pm-line"></span>
    <span class="pm-fill" style="width:${curIdx > 0 ? `calc((100% - 8px) * ${curIdx / (STAGES.length - 1)})` : '0'};background:${color};"></span>
    ${dots}
  </div>`;
}
// 集团弹层：先按单位分组，再列出该单位下的各岗位；点任意岗位进它的详情
function openGroupSheet(groupName) {
  const recs = records.filter(r => (r.group_name || '').trim() === groupName);
  const gp = groupProgress(recs) || { stage: '投递', date: '' };
  const color = COLORS[gp.stage] || '#2B6CFF';
  const byUnit = new Map();
  for (const r of recs) {
    const k = unitKey(r);
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k).push(r);
  }
  let inner = '';
  for (const [, urs] of byUnit) {
    const label = unitLabel(urs);
    // 一个单位下只有 1 个岗位时不再单独起标题（标题 + 卡片两层是重复结构），单位名并进卡片
    if (urs.length > 1) {
      inner += `<div class="u-group-head">${esc(label)}<span class="u-group-n">${urs.length} 个岗位</span></div>`
        + urs.map(r => posRowHTML(r, false, '')).join('');
    } else {
      inner += posRowHTML(urs[0], false, label);
    }
  }
  $('#sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-company">${esc(groupName)}</div>
      <span class="pill" style="background:${color}">${esc(gp.stage)}</span>
    </div>
    <div class="sheet-sub">${byUnit.size} 个单位 · ${recs.length} 个岗位 · 点任意岗位查看 / 编辑详情</div>
    <div class="g-list">${inner}</div>
    <div class="sheet-actions">
      <button class="btn primary block" data-addunder="${esc(groupName)}">＋ 在此集团下新增投递</button>
    </div>`;
  sheetId = null;
  $('#sheet').classList.remove('hidden');
  overlayOpen('sheet');   // 进入历史栈，返回键可关掉弹层而不是退出应用
}
// 单位弹层：列出同一个单位（company + sub_unit）下的所有岗位
function openUnitSheet(key) {
  const recs = records.filter(r => unitKey(r) === key)
    .sort((a, b) => new Date(b.update_time || 0) - new Date(a.update_time || 0));
  if (!recs.length) return;
  const gp = groupProgress(recs) || { stage: '投递', date: '' };
  const color = COLORS[gp.stage] || '#2B6CFF';
  $('#sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-company">${esc(unitLabel(recs))}</div>
      <span class="pill" style="background:${color}">${esc(gp.stage)}</span>
    </div>
    <div class="sheet-sub">${recs.length} 个岗位 · 点任意岗位查看 / 编辑详情</div>
    <div class="g-list">${recs.map(r => posRowHTML(r, true)).join('')}</div>`;
  sheetId = null;
  $('#sheet').classList.remove('hidden');
  overlayOpen('sheet');   // 进入历史栈，返回键可关掉弹层而不是退出应用
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
  // 备注图片：点开看大图（viewer 由 app.js 统一挂在 body 上）
  const imgs = imgsOf(rec);
  if (imgs.length) {
    remarkHTML += `
      <div class="sheet-field">
        <div class="sheet-field-label">备注图片（${imgs.length}）</div>
        <div class="sheet-imgs">${imgs.map((im, k) => `<img class="sheet-img"
           src="${esc(im.url || publicUrlOf(im.path))}" alt="备注图片 ${k + 1}" loading="lazy"
           data-preview="${esc(im.url || publicUrlOf(im.path))}">`).join('')}</div>
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

  // 同一单位下的其他岗位：不用回列表找，直接从详情跳过去
  const siblings = records.filter(r => r.id !== rec.id && unitKey(r) === unitKey(rec));
  const sibHTML = siblings.length ? `
    <div class="sheet-sec-title">该单位其他岗位（${siblings.length}）</div>
    <div class="g-list">${siblings.map(r => posRowHTML(r, false)).join('')}</div>` : '';

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
    ${sibHTML}
    <div class="sheet-actions">
      <button class="btn ghost" data-edit="${rec.id}">编辑全部</button>
      <button class="btn danger" data-del="${rec.id}">删除</button>
    </div>`;
}
async function patchSheetDates(id, dates, msg) {
  const ref = records.find(r => r.id === id); if (!ref) return;
  const next = { ...(ref.stage_dates || {}), ...dates };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  const derived = stageFromDates(next);
  const patch = {
    stage_dates: next,
    apply_date: next['投递'] || null,
    update_time: new Date().toISOString(),
    stage: derived || '投递',
  };
  const { error } = await sb.from('applications').update(patch).eq('id', id);
  if (error) { toast('更新失败：' + error.message, 'error'); return; }
  if (msg) toast(msg, 'success');
  await loadRecords();
  renderFeed();
  renderSheet(id);
}

async function patchSheetDate(id, stage, value, opts) {
  const dates = { ...(value ? { [stage]: value } : {}) };
  await patchSheetDates(id, dates, (opts && opts.silent) ? '' : (value ? ('已记录 · 当前阶段：' + (stageFromDates({ ...(records.find(r => r.id === id) || {}).stage_dates, ...dates }) || '投递')) : '已清除该日期'));
}

// ---------- 账户 ----------
function renderAccount() {
  $('#account-email').textContent = user.email || '';
  $('#account-avatar').textContent = (user.email || '我')[0].toUpperCase();
}
function exportCSV() {
  const headers = ['集团', '单位', '二级单位', 'Base', '岗位', '阶段', '投递日期', '链接', '备注'];
  const rows = records.map(r => [r.group_name || '', r.company, r.sub_unit, r.base, r.position, r.stage, r.apply_date || '', r.link || '', r.remark || '']);
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const csv = [headers, ...rows].map(row => row.map(q).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `多投投递记录_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('已导出 CSV 到本地', 'success');
}
// 把历史记录里不规范的 Base（如「福建莆田」「福建 莆田」）批量改写成「省 + 市」标准写法
async function normalizeAllBases() {
  const pending = records.filter(r => r.base && normalizeLocation(r.base) !== r.base);
  if (!pending.length) { toast('所有 Base 已经是规范写法', 'success'); return; }
  if (!confirm(`将把 ${pending.length} 条记录的 Base 改写成标准地名（如「福建莆田」→「福建省莆田市」），继续？`)) return;
  const jobs = pending.map(async r => {
    const { error } = await sb.from('applications')
      .update({ base: normalizeLocation(r.base), update_time: new Date().toISOString() })
      .eq('id', r.id);
    return error ? 0 : 1;
  });
  const done = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
  await loadRecords();
  toast(done ? `已规范 ${done} 条 Base 地名` : '规范失败，请重试');
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
  $('#fab').addEventListener('click', () => openEditView());

  // feed 筛选
  $('#feed-filters').addEventListener('click', (e) => {
    const t = e.target.closest('[data-filter]'); if (!t) return;
    feedFilter = t.dataset.filter;
    feedShown = PAGE_SIZE;      // 条件变了就回到第一页
    renderFeed();
  });
  $('#feed-more').addEventListener('click', () => { feedShown += PAGE_SIZE; renderFeed(); });
  $('#search-more').addEventListener('click', () => { searchShown += PAGE_SIZE; renderSearch(); });
  setupAutoLoadMore();

  // 列表卡片：单位卡 → 单位弹层，集团卡 → 集团弹层，单卡 → 详情（feed + search 共用）
  ['feed-list', 'search-list'].forEach(id => {
    $('#' + id).addEventListener('click', (e) => {
      const card = e.target.closest('.rec'); if (!card) return;
      if (card.dataset.unit) { openUnitSheet(decodeURIComponent(card.dataset.unit)); return; }
      if (card.dataset.group) { openGroupSheet(card.dataset.group); return; }
      openSheet(Number(card.dataset.id));
    });
  });

  // 搜索：任一筛选 / 排序变化都重置分页
  const onSearchChange = () => { searchShown = PAGE_SIZE; renderSearch(); };
  $('#search-kw').addEventListener('input', (e) => { searchState.kw = e.target.value; onSearchChange(); });
  $('#search-base').addEventListener('input', (e) => { searchState.base = e.target.value; onSearchChange(); });
  $('#search-unit').addEventListener('input', (e) => { searchState.unit = e.target.value; onSearchChange(); });
  $('#search-position').addEventListener('input', (e) => { searchState.position = e.target.value; onSearchChange(); });
  $('#search-sort').addEventListener('change', (e) => { searchState.sort = e.target.value; onSearchChange(); });
  $('#search-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    searchState.stage = t.dataset.stage; onSearchChange();
  });
  $('#search-clear').addEventListener('click', () => {
    searchState = { ...searchState, kw: '', unit: '', position: '', base: '', stage: '全部' };
    $('#search-kw').value = ''; $('#search-unit').value = '';
    $('#search-position').value = ''; $('#search-base').value = '';
    onSearchChange();
  });

  // 详情弹层
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const child = e.target.closest('[data-child]');
    if (child) { openSheet(Number(child.dataset.child)); return; }
    const addUnder = e.target.closest('[data-addunder]');
    // 集团名必须经 openEditView 的 opts.group 传入；先写 draftGroup 再调用会被 opts.group||'' 清空
    if (addUnder) { openEditView({ mode: 'group', group: addUnder.dataset.addunder }); return; }
    if (handleImgClick(e)) return;
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
    if (ed) { const id = Number(ed.dataset.edit); closeSheet(); openEditView({ id }); return; }
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
  // 编辑页 / 详情弹层 / 集团行里的日期框：点进去还空着就直接补今天，可直接改数字
  [$('#edit-dates'), $('#sheet'), $('#g-rows')].forEach((box) => {
    if (!box) return;
    box.addEventListener('focusin', (e) => {
      const el = e.target.closest('input[data-dp], input[data-sds], input[data-gf="date"]');
      if (!el) return;
      const t = focusFillDate(el);
      if (t) commitFocusDate(el, t);
    });
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
      dateSkip.add('dp:' + cl.dataset.clear);
      delete draftDates[cl.dataset.clear];
      const derived = stageFromDates(draftDates);
      draftStage = derived || '投递';
      renderDateRows();
      renderEditStagesOnly();
    }
  });
  $('#btn-save').addEventListener('click', saveRecord);
  $('#btn-cancel').addEventListener('click', cancelEdit);
  // 单个单位 / 集团投递 模式切换
  $('#f-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    const toGroup = btn.dataset.mode === 'group';
    // 单个单位里已填了集团名，切到集团模式时带过去，省得再打一遍
    if (toGroup && !$('#f-group').value.trim() && $('#f-group-single').value.trim()) {
      $('#f-group').value = $('#f-group-single').value.trim();
    }
    setModeUI(btn.dataset.mode);
    clearAllErrors();
    // 两套表单高度差很大，切完回到顶部，否则用户会停在中间看不出表单变了
    const scroller = $('.edit-scroll');
    if (scroller) scroller.scrollTop = 0;
    if (toGroup) $('#f-group').focus({ preventScroll: true });
    updateGroupHint();
  });
  // 各阶段日期折叠区
  $('#dates-toggle').addEventListener('click', () => {
    const btn = $('#dates-toggle');
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    $('#edit-dates').classList.toggle('hidden', open);
  });
  // 输入即清除该字段的行内错误
  $('#f-company').addEventListener('input', () => clearError('#f-company', '#err-company'));
  $('#f-group').addEventListener('input', () => clearError('#f-group', '#err-group'));
  // 集团模式：单位卡（单位名 / 投递日）+ 岗位行（各自 Base / 备注）
  $('#g-rows').addEventListener('input', (e) => {
    const t = e.target;
    const u = findUnit(t.dataset.uk);
    if (!u) return;
    const eu = $('#err-units'); if (eu) eu.classList.add('hidden');
    if (t.dataset.gf) { u[t.dataset.gf] = t.value; return; }
    if (setPositionMeta(u, t)) return;      // 岗位行内的 Base 地 / 备注
    if (t.dataset.pk) editPositionName(u, t.dataset.pk, t.value, t);
  });
  $('#g-rows').addEventListener('click', (e) => {
    const add = e.target.closest('[data-padd]');
    if (add) { addPosition(add.dataset.padd); return; }
    const delP = e.target.closest('[data-pdel]');
    if (delP) { removePosition(delP.dataset.uk, delP.dataset.pdel); return; }
    const delU = e.target.closest('[data-udel]');
    if (delU) { removeUnit(delU.dataset.udel); return; }
    if (handleImgClick(e)) return;
  });
  $('#g-add').addEventListener('click', () => {
    if (draftUnits.length >= MAX_UNITS) { toast(`最多 ${MAX_UNITS} 个单位`); return; }
    draftUnits.push(newUnit());
    renderUnits();
    const last = $('#g-rows .u-card:last-child .gr-sub');
    if (last) last.focus();
  });
  // 单个单位模式：岗位行（同一套组件）
  $('#single-positions').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.pk) return;
    const ep = $('#err-positions'); if (ep) ep.classList.add('hidden');
    if (setPositionMeta(draftUnits[0], t)) return;   // 岗位行内的 Base 地 / 备注
    editPositionName(draftUnits[0], t.dataset.pk, t.value, t);
  });
  // 岗位行 Base 地失焦时按地名表归一化（与整单 Base 输入同一口径，避免「雄安 / 北京朝阳」这类写法落库）
  for (const sel of ['#single-positions', '#g-rows']) {
    document.querySelector(sel).addEventListener('blur', (e) => {
      const t = e.target;
      if (!t.classList.contains('pi-base')) return;
      const norm = normalizeLocation(t.value.trim());
      if (norm && norm !== t.value) t.value = norm;
    }, true);   // 捕获阶段：blur 不冒泡，用 capture 才能在离开输入框时拿到
  }
  $('#single-positions').addEventListener('click', (e) => {
    const delP = e.target.closest('[data-pdel]');
    if (delP) { removePosition(delP.dataset.uk, delP.dataset.pdel); return; }
    handleImgClick(e);
  });
  $('#p-add-single').addEventListener('click', () => addPosition(draftUnits[0].key));
  // 集团名输入时，命中已有集团则提示将自动归并（两处集团名输入都监听）
  $('#f-group').addEventListener('input', updateGroupHint);
  $('#f-group-single').addEventListener('input', updateGroupHint);
  // 批量粘贴：按钮就地展开 / 收起（不靠失焦状态，关闭动作始终有一个明确的入口）
  // mousedown 先 preventDefault，避免 textarea 失焦触发 blur 并入后，紧接着这次点击又把它打开
  $('#f-pos-batch').addEventListener('mousedown', (e) => e.preventDefault());
  $('#f-pos-batch').addEventListener('click', () => {
    const btn = $('#f-pos-batch');
    const open = btn.dataset.on !== '1';
    setBatchMode(open, { merge: !open });
    if (open) $('#f-position-multi').focus();
  });
  // 点别处：有内容就并入并收起，没内容也收起（不然会留在展开态，看着像关不掉）
  $('#f-position-multi').addEventListener('blur', () => {
    if ($('#batch-box').classList.contains('hidden')) return;
    setBatchMode(false, { merge: true });
  });
  $('#f-position-multi').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setBatchMode(false, { merge: true }); }
  });
  $('#btn-delete').addEventListener('click', () => deleteRecord());

  // 账户
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-fix-base').addEventListener('click', normalizeAllBases);
  $('#btn-signout').addEventListener('click', () => sb.auth.signOut());

  // 安卓返回键：先关掉最上面那层覆盖（详情弹层 / 编辑页），没有覆盖层才真的离开页面。
  // 少了这条监听，覆盖层不在历史栈里时按返回会直接退出应用。
  window.addEventListener('popstate', () => closeOverlayByBack());
  // Esc：关弹层；正在批量粘贴时优先收起批量框（此时弹层还没打开）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (imgViewer && !imgViewer.classList.contains('hidden')) { closeImageViewer(); return; }  // 大图在最上层，先关它
    if (overlayKind) { closeOverlayByBack(); return; }
    const bb = $('#batch-box');
    if (bb && !bb.classList.contains('hidden')) setBatchMode(false, { merge: true });
  });
  // chip 是 span、卡片是 div（筛选 / 阶段切换 / 进详情），天生聚焦不到：补成可聚焦、Enter / 空格可操作
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (!t || !t.closest) return;
    const hit = t.closest('.chip, .rec, .g-child-row');
    if (!hit) return;
    e.preventDefault();
    hit.click();
  });
}

// 切阶段时只刷新 chips
function renderEditStagesOnly() {
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] : ''}" role="button" tabindex="0">${s}</span>`).join('');
}

// ---------- 启动 ----------
bindEvents();
initAuth();
