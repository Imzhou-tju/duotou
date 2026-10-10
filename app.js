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
// 岗位附件（存的是图片文件）：Supabase Storage 公开桶，路径固定 {user.id}/xxx，权限由 storage.objects 策略按目录限制
const IMG_BUCKET = 'remark-media';
const IMG_MAX_EDGE = 1600;      // 压缩后长边上限（px）
const IMG_MAX_EDGE_PNG = 2400;  // 截图类 PNG 文字多，放宽一点避免字糊
const MAX_IMGS_PER_POS = 4;     // 单个岗位最多几张
const MAX_IMG_INPUT_MB = 12;    // 选图时的原始体积上限
let uidSeq = 0;
function nextKey(p) { return p + (++uidSeq); }
// Base 地 / 岗位描述挂在「岗位」上：同一个单位的不同岗位，Base 地和描述可能不一样（如总部岗 vs 外地岗）
// 阶段同样按岗位独立：每个岗位自带 stage / stageDates，阶段区只是批量写入这些岗位的工具
function newPosition(name) {
  return { key: nextKey('p'), recId: null, name: name || '', base: '', remark: '', imgs: [],
    stage: draftStage || '投递', stageDates: { ...(draftDates || {}) }, stageTimes: { ...(draftTimes || {}) } };
}
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
// 这三个要排在 draftUnits 前面：draftUnits 初始化时 newUnit() → newPosition() 会读它们
let draftStage = '投递';
let draftDates = {};
// 阶段具体时间：与 draftDates 同键（阶段 → "HH:MM"），只对填了日期的阶段有意义。
// 单独一份而不是塞进 draftDates，目的是让 draftDates 保持「阶段 → YYYY-MM-DD」的单一形态，
// stageFromDates 那套「日期推导阶段」的逻辑完全不用改。
let draftTimes = {};
// 阶段应用范围：null = 尚未点过圈（全部岗位，新增岗位自动纳入）；Set<岗位key> = 显式勾选的岗位
//（独立开关：勾满全部也保留为 Set、空集也保留为 Set，不折叠回 null，否则点圈语义会跳变）。
// 只在单个单位模式下且岗位数 > 1 时可改，其余场景恒为 null
let stageScope = null;
let draftUnits = [newUnit()];   // 表单里的单位列表：每个单位下挂多个岗位；单个单位模式只用第一个单位来装岗位
let groupEditStageDates = null;   // 集团模式编辑已有记录时，保留该记录原有的各阶段日期（投递日由行内输入覆盖）
let groupEditStageTimes = null;   // 同上，各阶段具体时间
let groupEditStage = '投递';
// ---------- 草稿自动保存 ----------
// 编辑页填写过程中持续把表单状态快照到 localStorage（按用户隔离），关闭页面 / 中断后能恢复。
// 纯前端方案，不动数据库；图片已在选图时上传到私有桶，草稿只记 path，恢复时重新签 URL。
const DRAFT_PREFIX = 'duotou-draft:';
let draftPollTimer = null;      // 编辑页可见时的轮询定时器（每秒比对一次，变了才写）
let lastDraftSnapshot = '';     // 上次写进 localStorage 的序列化串，避免空转重写
let restoringDraft = false;     // 正在恢复草稿：renderEdit 走恢复分支
let draftScratch = null;        // 恢复草稿时暂存「游离字段」（公司名 / 链接，不在 draftUnits 里）
let feedFilter = 'all';
let searchState = { kw: '', stage: '全部', sort: 'update' };
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
// 注意：国家级新区属于某个市，不能当成独立城市，否则「成都天府新区」会被解析成「四川省天府新区」
const CITY_SHORT_ALIAS = {
  '雄安': '河北省雄安新区',
  '雄安新区': '河北省雄安新区',
  '浦东': '上海市', '浦东新区': '上海市', '张江': '上海市', '临港': '上海市', '陆家嘴': '上海市',
  '滨海': '天津市', '滨海新区': '天津市', '生态城': '天津市',
  '两江': '重庆市', '两江新区': '重庆市',
  '天府': '四川省成都市', '天府新区': '四川省成都市',
  '江北新区': '江苏省南京市',
  '光谷': '湖北省武汉市', '东湖高新': '湖北省武汉市',
  '前海': '广东省深圳市', '大鹏': '广东省深圳市',
  '未来科技城': '浙江省杭州市',
};
Object.assign(CITY_LOOKUP, CITY_SHORT_ALIAS);

// 常见「区 / 片区 / 园区」→ 所属城市。只作兜底：前面都没命中时才用，
// 因此不会覆盖同名城市（如辽宁朝阳市 vs 北京朝阳区）。已刻意避开有歧义的名（朝阳、高新、江北）。
const DISTRICT_ALIAS = {
  // 直辖市
  '东城': '北京市', '西城': '北京市', '海淀': '北京市', '中关村': '北京市', '亦庄': '北京市',
  '望京': '北京市', '国贸': '北京市', '金融街': '北京市', '丰台': '北京市', '石景山': '北京市',
  '门头沟': '北京市', '昌平': '北京市', '大兴': '北京市', '顺义': '北京市',
  '房山': '北京市', '怀柔': '北京市', '平谷': '北京市', '密云': '北京市', '延庆': '北京市',
  // 北京高频工作地（多为「首都××区」以外的园区/居住区，唯一指向北京）
  '后厂村': '北京市', '西二旗': '北京市', '亚运村': '北京市', '回龙观': '北京市',
  '天通苑': '北京市', '良乡': '北京市', '五道口': '北京市',
  // 说明：跨省重名的区一律不收录（如「通州」北京/南通都有、「鼓楼」南京/福州/开封都有、「长安区」西安/石家庄都有），
  //       这类写法请带城市前缀写（如「北京通州」），带前缀时由城市名子串命中，不会错配。
  '和平': '天津市', '南开': '天津市', '河西': '天津市', '河东': '天津市', '河北区': '天津市',
  '红桥': '天津市', '西青': '天津市', '津南': '天津市', '北辰': '天津市', '武清': '天津市',
  '宝坻': '天津市', '静海': '天津市', '宁河': '天津市', '蓟州': '天津市',
  '徐汇': '上海市', '长宁': '上海市', '静安': '上海市', '黄浦': '上海市', '普陀': '上海市',
  '虹口': '上海市', '杨浦': '上海市', '闵行': '上海市', '宝山': '上海市', '嘉定': '上海市',
  '松江': '上海市', '青浦': '上海市', '奉贤': '上海市', '金山': '上海市', '崇明': '上海市',
  '漕河泾': '上海市', '金桥': '上海市', '徐家汇': '上海市', '五角场': '上海市', '外高桥': '上海市',
  '渝中': '重庆市', '南岸': '重庆市', '九龙坡': '重庆市', '沙坪坝': '重庆市', '大渡口': '重庆市',
  '渝北': '重庆市', '巴南': '重庆市', '璧山': '重庆市',
  // 省会 / 计划单列市
  '南山': '广东省深圳市', '福田': '广东省深圳市', '罗湖': '广东省深圳市', '宝安': '广东省深圳市',
  '龙岗': '广东省深圳市', '龙华': '广东省深圳市', '坪山': '广东省深圳市', '光明': '广东省深圳市',
  '盐田': '广东省深圳市',
  '天河': '广东省广州市', '越秀': '广东省广州市', '海珠': '广东省广州市', '荔湾': '广东省广州市',
  '白云': '广东省广州市', '番禺': '广东省广州市', '黄埔': '广东省广州市', '南沙': '广东省广州市',
  '花都': '广东省广州市', '增城': '广东省广州市', '从化': '广东省广州市',
  '西湖': '浙江省杭州市', '滨江': '浙江省杭州市', '余杭': '浙江省杭州市', '萧山': '浙江省杭州市',
  '拱墅': '浙江省杭州市', '上城': '浙江省杭州市', '钱塘': '浙江省杭州市', '临平': '浙江省杭州市',
  '玄武': '江苏省南京市', '建邺': '江苏省南京市', '江宁': '江苏省南京市',
  '浦口': '江苏省南京市', '栖霞': '江苏省南京市', '雨花台': '江苏省南京市', '六合': '江苏省南京市',
  '工业园区': '江苏省苏州市', '姑苏': '江苏省苏州市', '吴江': '江苏省苏州市', '昆山': '江苏省苏州市',
  '江汉': '湖北省武汉市', '武昌': '湖北省武汉市', '洪山': '湖北省武汉市', '汉口': '湖北省武汉市',
  // 注意：「东西湖」必须收录——它含子串「西湖」，不收录会被判成杭州
  '东西湖': '湖北省武汉市',
  '锦江': '四川省成都市', '青羊': '四川省成都市', '武侯': '四川省成都市', '成华': '四川省成都市',
  '龙泉驿': '四川省成都市', '郫都': '四川省成都市', '新都': '四川省成都市', '温江': '四川省成都市',
  '双流': '四川省成都市',
  '雁塔': '陕西省西安市', '未央': '陕西省西安市', '碑林': '陕西省西安市', '莲湖': '陕西省西安市',
  '灞桥': '陕西省西安市',
  '岳麓': '湖南省长沙市', '雨花': '湖南省长沙市', '开福': '湖南省长沙市', '芙蓉': '湖南省长沙市',
  '天心': '湖南省长沙市',
  '崂山': '山东省青岛市', '市南': '山东省青岛市', '市北': '山东省青岛市', '黄岛': '山东省青岛市',
  '城阳': '山东省青岛市', '李沧': '山东省青岛市',
  '思明': '福建省厦门市', '湖里': '福建省厦门市', '集美': '福建省厦门市', '海沧': '福建省厦门市',
  '同安': '福建省厦门市', '翔安': '福建省厦门市',
  '金水': '河南省郑州市', '郑东新区': '河南省郑州市', '航空港': '河南省郑州市',
  '蜀山': '安徽省合肥市', '包河': '安徽省合肥市', '瑶海': '安徽省合肥市', '庐阳': '安徽省合肥市',
  '滨湖': '安徽省合肥市',
  '海曙': '浙江省宁波市', '鄞州': '浙江省宁波市', '北仑': '浙江省宁波市', '镇海': '浙江省宁波市',
  // 第二批次：更多城市的高频区名 / 片区名 / 县级市（写 Base 时常只填后半截的场景）
  '后海': '广东省深圳市', '蛇口': '广东省深圳市', '车公庙': '广东省深圳市', '坂田': '广东省深圳市',
  '琶洲': '广东省广州市', '珠江新城': '广东省广州市',
  '顺德': '广东省佛山市', '松山湖': '广东省东莞市', '香洲': '广东省珠海市', '石岐': '广东省中山市',
  '惠城': '广东省惠州市',
  '钱江新城': '浙江省杭州市', '下沙': '浙江省杭州市',
  '仙林': '江苏省南京市', '崇川': '江苏省南通市', '新吴': '江苏省无锡市', '武进': '江苏省常州市',
  '相城': '江苏省苏州市', '吴中': '江苏省苏州市', '太仓': '江苏省苏州市',
  '张家港': '江苏省苏州市', '常熟': '江苏省苏州市',
  '慈溪': '浙江省宁波市', '余姚': '浙江省宁波市', '义乌': '浙江省金华市',
  '瓯海': '浙江省温州市', '龙湾': '浙江省温州市', '鹿城': '浙江省温州市',
  '历下': '山东省济南市', '芝罘': '山东省烟台市', '西海岸': '山东省青岛市',
  '浑南': '辽宁省沈阳市', '旅顺': '辽宁省大连市', '南岗': '黑龙江省哈尔滨市', '净月': '吉林省长春市',
  '裕华': '河北省石家庄市', '小店': '山西省太原市', '红谷滩': '江西省南昌市',
  '呈贡': '云南省昆明市', '观山湖': '贵州省贵阳市', '青秀': '广西壮族自治区南宁市',
  '望城': '湖南省长沙市', '麓谷': '湖南省长沙市', '政务区': '安徽省合肥市', '硚口': '湖北省武汉市',
  '二七': '河南省郑州市',
  // 环京通勤带：行政上属廊坊/保定，但常被直接当作 Base 写
  '燕郊': '河北省廊坊市', '固安': '河北省廊坊市', '涿州': '河北省保定市',
};
// 长名优先：如「滨海新区」要先于「滨海」被扫到（两者都指向同一个市，这里主要是避免未来表里出现长名被短名截断）
const ALL_DISTRICT_KEYS = Object.keys(DISTRICT_ALIAS).sort((a, b) => b.length - a.length);

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

// 在字符串里找城市：先精确（省 → 城），再按最长子串匹配，最后兜底认常见区 / 片区名
function matchCity(str) {
  if (PROV_ALIAS[str]) return PROV_ALIAS[str];
  if (CITY_LOOKUP[str]) return CITY_LOOKUP[str];
  // 子串命中取「最长」，长度相同时取「在字符串里最靠前」的那个，
  // 避免结果依赖键表顺序（如「北京朝阳区」应得北京市，而不是辽宁省朝阳市）
  let best = '';
  for (const k of ALL_CITY_KEYS) {
    if (!str.includes(k)) continue;
    if (!best || k.length > best.length
      || (k.length === best.length && str.indexOf(k) < str.indexOf(best))) best = k;
  }
  if (best) return CITY_LOOKUP[best];
  // 兜底：只写了个区名 / 片区名的情况（如「海淀」「张江」「河北区」）
  for (const k of ALL_DISTRICT_KEYS) if (str.includes(k)) return DISTRICT_ALIAS[k];
  return '';
}

// 多地点分隔符：中英文逗号、顿号、斜杠、竖线、&、连接词（和 / 或 / 与 / 及），以及空白
const MULTI_BASE_SPLIT = /[/,，、|&;；]+|\s*[和或与及]\s*|\s+/;
// 归一后拼接用的分隔符（必须本身就在上面的分隔符集合里，保证再归一一次结果不变 = 幂等）
const MULTI_BASE_JOIN = '、';

// 「省 + 市」两截写法（福建 莆田 / 福建-莆田），认不出来返回 ''
function matchProvCityPair(a, b) {
  const prov = PROV_ALIAS[a];
  if (!prov) return '';
  const cb = matchCity(b);
  if (DIRECT_MUNICIPALITIES.includes(prov)) {
    // 直辖市 + 区名 → 直辖市（如「上海 浦东」「北京 海淀」）。
    // 后半截是别的城市（「北京 上海」）或根本认不出（「北京 远程」）都不能算这一对，交给多地点处理。
    return cb === prov ? prov : '';
  }
  return cb && cb.startsWith(prov) ? cb : '';                 // 市确实属于这个省才算命中
}

// 单段地名的归一化，认不出来返回 ''
function normalizeSingle(s) {
  const parts = s.split(/[\s\-—–·]+/).filter(Boolean);
  if (parts.length === 2) {
    const pair = matchProvCityPair(parts[0], parts[1]) || matchProvCityPair(parts[1], parts[0]);
    if (pair) return pair;
    // 两截指向同一个城市 → 是「城市 + 片区」写法（如「成都 天府新区」「杭州 滨江」）
    const ca = matchCity(parts[0]), cb = matchCity(parts[1]);
    if (ca && ca === cb) return ca;
    return '';                                                // 两截都是城市 → 交给上层当多地点处理
  }
  return matchCity(s) || '';
}

// 这一段的归一结果本身就是一个完整城市名时才算「独立地点」。
// 用来区分两类写法：「雄安新区」→「河北省雄安新区」去掉省名后仍是自己 → 独立地点；
// 「朝阳区」→「辽宁省朝阳市」只是被子串带偏了 → 不是独立地点，应归属到前面的城市。
function cityLevelOf(seg) {
  const v = normalizeSingle(seg);
  if (!v) return '';
  const short = v.includes('省') ? v.split('省').pop() : v;
  return (short === seg || short === seg + '市') ? v : '';
}

// 这一段是不是属于某个城市的次级地名（区 / 县 / 旗 / 片区）
function isSubPlaceOf(seg, city) {
  if (/[区县旗]$/.test(seg)) return true;
  for (const k of ALL_DISTRICT_KEYS) if (DISTRICT_ALIAS[k] === city && seg.includes(k)) return true;
  return false;
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const segs = s.split(MULTI_BASE_SPLIT).map(x => x.trim()).filter(Boolean);
  if (segs.length < 2) return normalizeSingle(s) || s;
  // 恰好两截时，先试试能不能合并理解：「省 + 市」或「城市 + 片区」，合成不了才是真的多地点
  if (segs.length === 2) {
    const pair = matchProvCityPair(segs[0], segs[1]) || matchProvCityPair(segs[1], segs[0]);
    if (pair) return pair;
    const ca = matchCity(segs[0]), cb = matchCity(segs[1]);
    if (ca && ca === cb) return ca;
  }
  // 多地点：逐段归一后去重拼回；出现既认不出、又无法归属到前一段城市的段 → 整条原样保留
  const out = [];
  for (const seg of segs) {
    const own = cityLevelOf(seg);
    if (own) { if (!out.includes(own)) out.push(own); continue; }
    const prev = out[out.length - 1];
    if (prev && isSubPlaceOf(seg, prev)) continue;   // 「北京 朝阳区」「石家庄 裕华区」
    return s;
  }
  if (!out.length) return s;
  return out.length === 1 ? out[0] : out.join(MULTI_BASE_JOIN);
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
  // 桶已私有化：图片不再有公开 URL，只能取带时效的签名 URL（渲染时会由 hydrateImages 统一刷新）
  let signedUrl = '';
  try {
    const { data } = await sb.storage.from(IMG_BUCKET).createSignedUrl(path, SIGNED_TTL);
    signedUrl = (data && data.signedUrl) || '';
  } catch (e) { /* 文件已上传成功，签名这次取不到就等下次渲染 hydrateImages 再补 */ }
  return { path, url: signedUrl, w: width, h: height, size: blob.size };
}
// ===== 附件读取：桶私有化后只能用签名 URL 访问（带时效，且只对当前登录用户有效） =====
const SIGNED_TTL = 3600;                 // 签名 URL 有效期（秒）
const signedCache = new Map();           // path -> { url, exp }：同一张图在一次会话里只签一次
function purgeSignedCache() { signedCache.clear(); }
// 批量换签名：优先用缓存，只对缺的部分发一次 createSignedUrls
async function signedUrlsOf(paths) {
  const map = new Map();
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length) return map;
  const now = Date.now();
  const miss = [];
  for (const p of list) {
    const hit = signedCache.get(p);
    if (hit && hit.exp > now) map.set(p, hit.url); else miss.push(p);
  }
  if (!miss.length) return map;
  try {
    const { data, error } = await sb.storage.from(IMG_BUCKET).createSignedUrls(miss, SIGNED_TTL);
    if (!error && Array.isArray(data)) {
      for (const it of data) {
        if (it && it.path && it.signedUrl) {
          map.set(it.path, it.signedUrl);
          signedCache.set(it.path, { url: it.signedUrl, exp: now + (SIGNED_TTL - 120) * 1000 });
        }
      }
    }
  } catch (e) { /* 这次取不到就留空，下次渲染会再试 */ }
  return map;
}
// 渲染完再回填 src：所有 <img data-path> 拿到签名 URL 才显示，同时补 data-preview 供点开看大图
async function hydrateImages(root) {
  const els = [...(root || document).querySelectorAll('img[data-path]')]
    .filter(el => el.dataset.path && !el.dataset.loaded);
  if (!els.length) return;
  const map = await signedUrlsOf(els.map(el => el.dataset.path));
  for (const el of els) {
    el.dataset.loaded = '1';
    const url = map.get(el.dataset.path) || '';
    if (url) { el.src = url; el.dataset.preview = url; }
    else el.classList.add('img-broken');
  }
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
// 阶段具体时间：只认有日期的项（历史数据可能缺这一列，统一兜底成空对象）
function timesOf(rec) {
  const src = (rec && rec.stage_dates_at) || {};
  const dates = (rec && rec.stage_dates) || {};
  const out = {};
  for (const [s, t] of Object.entries(src)) {
    const v = cleanTime(t);
    if (v && dates[s]) out[s] = v;
  }
  return out;
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

// ---------- 阶段具体时间（面试 / 笔试几点开始） ----------
// 存库格式统一是 "HH:MM"（24 小时制、两位数），排序和「是不是今天已过」都依赖这个形态，
// 所以输入层允许手写「下午3点 / 15:00 / 3:30」这类写法，进来先归一化再落库。
const TIME_MINUTES = '00,30';        // 下拉刻度：整点与半点，够用又不至于列表太长
function pad2(n) { return String(n).padStart(2, '0'); }
// "14:30" / "14:30:00" → "14:30"；不合法返回 null
function cleanTime(v) {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return pad2(h) + ':' + pad2(mi);
}
// 自然语言时间解析：认不出一律返回 null（由调用方提示重填，不猜）
function parseTime(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;
  const direct = cleanTime(t);
  if (direct) return direct;
  // 「下午3点」「晚上8点半」「上午9:00」「14:30」
  let m = t.match(/^(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*[点:时]\s*(半|\d{1,2})?\s*分?$/)
       || t.match(/^(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：](\d{1,2})$/);
  if (!m) return null;
  const seg = m[1] || '';
  let h = +m[2];
  const tail = String(m[3] || '').trim();
  const mi = tail === '半' ? 30 : (tail ? +tail : 0);
  if (seg) {
    // 带时段词：按 12 小时制换算，写超过 12 的数字说明写错了
    if (h < 1 || h > 12) return null;
    if (seg === '下午' || seg === '傍晚' || seg === '晚上') { if (h < 12) h += 12; }
    else if (seg === '中午') { if (h < 12) h += 12; }
    else if (h === 12) h = 0;          // 凌晨 / 早上 / 上午 的 12 点 = 0 点
  } else if (h <= 7) {
    // 没写时段词的 1~7 点按下午理解（面试基本都在下午），别把「3点」存成凌晨 3 点
    h += 12;
  }
  if (h > 23 || mi > 59) return null;
  return pad2(h) + ':' + pad2(mi);
}
// 时间下拉：整点与半点，并把这条记录已经在用的自定义时间补进去（编辑旧数据时不丢）
function timeSelectHTML(attr, value) {
  const cur = cleanTime(value) || '';
  const opts = ['<option value="">未定</option>'];
  const seen = new Set(['']);
  for (let h = 7; h <= 22; h++) {
    for (const mm of TIME_MINUTES.split(',')) {
      const v = pad2(h) + ':' + mm;
      seen.add(v);
      opts.push(`<option value="${v}"${cur === v ? ' selected' : ''}>${v}</option>`);
    }
  }
  if (cur && !seen.has(cur)) opts.push(`<option value="${cur}" selected>${cur}</option>`);
  return `<select class="time-select" ${attr}>${opts.join('')}</select>`;
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
    applyBufferToTargets();      // 写到应用范围里的岗位并刷新徽章；只动徽章和范围列表，日期输入框焦点保留
    renderEditStagesOnly();
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
  if (name !== 'edit') stopDraftPolling();   // 离开编辑页：停轮询（草稿由保存成功清除 / 取消保留，轮询已持续落盘）
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
    $('#btn-signin').disabled = true; $('#btn-open-signup').disabled = true; $('#btn-signup').disabled = true;
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
  const companies = countMap(), positions = countMap(), bases = countMap();
  for (const r of records) {
    tally(companies, r.company);
    tally(positions, r.position);
    const b = normalizeLocation(r.base);
    // 多地点拆开分别计数，列表里才能提示到单个城市
    if (b) for (const part of String(b).split(MULTI_BASE_JOIN)) tally(bases, part.trim());
  }
  fill('#company-list', companies);
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
      ${rec.remark ? '<span class="rec-badge">📝 岗位描述</span>' : ''}
      ${hitBadgeHTML(rec)}
    </div>
  </div>`;
}

// ---------- 集团分组 ----------
// 搜索结果的命中标注：单卡标出这条靠哪个字段命中（首页不标注，searchHitMap 为空时返回空串）
function hitBadgeHTML(rec) {
  const field = searchHitMap.get(String(rec.id));
  return field ? `<span class="rec-badge hit">${esc(field)}命中</span>` : '';
}
// 聚合卡（集团 / 单位）下没有单条卡片可标，改为按命中字段汇总一行
function bucketHitHTML(recs) {
  if (!searchHitMap.size) return '';
  const tally = {};
  for (const r of recs) {
    const field = searchHitMap.get(String(r.id));
    if (field) tally[field] = (tally[field] || 0) + 1;
  }
  const parts = HIT_ORDER.filter(f => tally[f]).map(f => `${f}命中 ${tally[f]}`);
  return parts.length ? `<div class="hit-line">${parts.map(p => `<span class="hit-chip">${esc(p)}</span>`).join('')}</div>` : '';
}
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
// keepOrder=true 时保留传入顺序（搜索结果用：命中优先级已在 filteredRecords 排好，不能再被活动时间打乱）。
function bucketize(list, keepOrder) {
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
  if (!keepOrder) items.sort((a, b) => lastActive(b.recs) - lastActive(a.recs));
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
// 草稿提示条：feed 顶部显示「有未保存的投递草稿」，带单位 / 岗位数，供继续填写或丢弃
function renderDraftBanner() {
  const banner = $('#draft-banner');
  if (!banner) return;
  const d = readDraft();
  if (d && !draftIsEmpty(d)) {
    const sum = draftSummary(d);
    const bits = [];
    if (d.mode === 'group' && d.groupName) bits.push(d.groupName);
    else if (d.mode === 'single' && d.company) bits.push(d.company);
    if (sum.pos) bits.push(`${sum.pos} 个岗位`);
    $('#draft-banner-text').textContent = '有未保存的投递草稿' + (bits.length ? `（${bits.join(' · ')}）` : '');
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
// ---------- 日程 ----------
// 一条日程 = 「某条记录 × 某个阶段」，只要那一天在未来就收进来——具体时间可填可不填。
// 提醒窗口是今天起 7 天：今天之前（已经面过的）不提醒，第 8 天以后也先不占地方。
const SCHEDULE_DAYS = 7;
let schCollapsed = false;    // 日程块收起 / 展开：状态记在内存里，重渲染后保持
function scheduleItems() {
  const today = todayStr();
  const end = shiftDays(SCHEDULE_DAYS - 1);
  const out = [];
  for (const r of records) {
    const dates = r.stage_dates || {};
    const times = timesOf(r);
    for (const [stage, d] of Object.entries(dates)) {
      if (!d || d < today || d > end) continue;   // 只提醒今天起 7 天内
      out.push({ id: r.id, stage, date: d, time: times[stage] || '', rec: r });
    }
  }
  // 同一天里：还没填时间的排前面（待定），填了的按时间先后排。
  // 同组内的时间都相同时，按「阶段靠前」排，保证顺序稳定。
  const rank = (it) => ALL_STAGES.indexOf(it.stage);
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.time !== !b.time) return a.time ? 1 : -1;    // 没时间的在前
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return rank(a) - rank(b);
  });
  return out;
}
// 「今天 / 明天 / 后天」这类相对说法比「10月13日」好读得多，7 天内都写成相对日期
function dayLabel(dateStr) {
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${+m[1]}月${+m[2]}日` : dateStr;
}
// 日程条目：左侧时间（没填就写「全天」），右侧单位 / 岗位 / 阶段；点一下直接进那条记录的详情
function scheduleRowHTML(it) {
  const r = it.rec;
  const unit = unitLabel([r]) || r.company || '未命名单位';
  const color = COLORS[it.stage] || '#9AA0A6';
  const timeHTML = it.time
    ? `<div class="sch-time">${esc(it.time)}</div>`
    : '<div class="sch-time is-tbd">全天</div>';
  return `<div class="sch-row" data-sch="${it.id}" role="button" tabindex="0">
    ${timeHTML}
    <div class="sch-main">
      <div class="sch-line1">${esc(unit)}${r.position ? ' · ' + esc(r.position) : ''}</div>
      <div class="sch-line2">${esc(it.date)} ${esc(dayLabel(it.date))}</div>
    </div>
    <span class="sch-stage" style="background:${color}">${esc(it.stage)}</span>
  </div>`;
}
// 首页日程块：按日期分组，同一天内「待定时间在前、已定时间按点排」；没有安排就整块不显示（不占空间）
function renderSchedule() {
  const box = $('#schedule');
  if (!box) return;
  const items = scheduleItems();
  if (!items.length) {
    box.classList.add('hidden');
    $('#schedule-list').innerHTML = '';
    return;
  }
  const byDay = new Map();
  for (const it of items) {
    if (!byDay.has(it.date)) byDay.set(it.date, []);
    byDay.get(it.date).push(it);
  }
  const today = todayStr();
  const html = [...byDay.entries()].map(([d, list]) => `
    <div class="sch-day${d === today ? ' is-today' : ''}">
      <div class="sch-day-head"><span class="sch-day-lbl">${esc(dayLabel(d))}</span><span class="sch-day-date">${esc(d)}</span><span class="sch-day-n">${list.length} 场</span></div>
      ${list.map(scheduleRowHTML).join('')}
    </div>`).join('');
  $('#schedule-list').innerHTML = html;
  const tbd = items.filter(it => !it.time).length;
  $('#sch-meta').textContent = `未来 ${SCHEDULE_DAYS} 天 · ${items.length} 场`
    + (tbd ? `（${tbd} 场时间待定）` : '');
  box.classList.remove('hidden');
  // 收起状态在重渲染后要保住（否则每次改完数据又自己展开）
  const collapsed = schCollapsed;
  $('#schedule-list').classList.toggle('hidden', collapsed);
  $('#sch-toggle').textContent = collapsed ? '展开' : '收起';
  $('#sch-toggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  box.classList.toggle('collapsed', collapsed);
}
// 日程块收起 / 展开（状态记在内存里，重渲染后保持）
function renderFeed() {
  renderDraftBanner();
  renderSchedule();
  const err = loadState === 'error';
  searchHitMap.clear();       // 首页不做命中标注，清掉上一次搜索留下的标注
  // 统计条：已投递 = 全部投递记录数（每条都算投过）；一面/二面/Offer 按该阶段计数（拒绝/放弃不上统计条）
  const sent = records.length;
  const int1 = records.filter(r => r.stage === '一面').length;
  const int2 = records.filter(r => r.stage === '二面').length;
  const offers = records.filter(r => r.stage === 'Offer').length;
  $('#stat-sent').textContent = err ? '—' : sent;
  $('#stat-int1').textContent = err ? '—' : int1;
  $('#stat-int2').textContent = err ? '—' : int2;
  $('#stat-offer').textContent = err ? '—' : offers;
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
      ${bucketHitHTML(recs)}
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
    ${bucketHitHTML(recs)}
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
// 一个关键词同时匹配四类字段，并给出命中优先级：岗位名称 > 单位名称（公司/子公司/集团）> Base 地 > 岗位描述
const HIT_ORDER = ['岗位', '单位', 'Base', '描述'];
let searchHitMap = new Map();      // 本次搜索结果：记录 id → 命中字段（渲染卡片标注用）
function matchField(r, kw) {
  const has = (v) => String(v || '').toLowerCase().includes(kw);
  if (has(r.position)) return '岗位';
  if ([r.company, r.sub_unit, r.group_name].some(has)) return '单位';
  if ([r.base, normalizeLocation(r.base)].some(has)) return 'Base';
  if (has(r.remark)) return '描述';
  return '';
}
function filteredRecords() {
  const kw = searchState.kw.trim().toLowerCase();
  searchHitMap = new Map();
  const list = records.filter(r => {
    if (searchState.stage !== '全部' && r.stage !== searchState.stage) return false;
    if (!kw) return true;
    const field = matchField(r, kw);
    if (!field) return false;
    searchHitMap.set(String(r.id), field);
    return true;
  });
  const out = sortRecords(list);     // 先按用户选的排序方式排一遍
  if (kw) {
    // 再按命中优先级稳定重排：同优先级内保持上面那轮的顺序（sort 在现行浏览器里是稳定的）
    out.sort((a, b) => HIT_ORDER.indexOf(searchHitMap.get(String(a.id)))
                     - HIT_ORDER.indexOf(searchHitMap.get(String(b.id))));
  }
  return out;
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
  $('#search-sort').value = searchState.sort;
  const list = filteredRecords();
  const unitN = new Set(list.map(unitKey)).size;
  $('#search-count').textContent = searchState.kw.trim()
    ? `「${searchState.kw.trim()}」命中 ${list.length} 条 · ${unitN} 个单位`
    : `共 ${list.length} 条记录 · ${unitN} 个单位`;
  const hasFilter = !!(searchState.kw || searchState.stage !== '全部');
  $('#search-clear').classList.toggle('hidden', !hasFilter);
  $('#search-kw-clear').classList.toggle('hidden', !searchState.kw);

  // 结果同样按「集团 / 单位」聚合展示，与首页保持一致；但保留命中优先级顺序
  const items = bucketize(list, true);
  const shown = items.slice(0, searchShown);
  $('#search-list').innerHTML = shown.length
    ? shown.map(bucketCardHTML).join('')
    : `<div class="empty">没有匹配的记录</div>`;
  setMoreBtn('#search-more', shown.length, items.length);
}

// ---------- 编辑 ----------
// ---------- 草稿自动保存（localStorage，按用户隔离） ----------
// 编辑页可见期间每秒轮询比对一次，状态变了就写；关闭页面走 beforeunload 兜底落盘。
// 草稿只存文本 / 图片 path，不存签名 URL（会过期），恢复时由 hydrateImages 重新签。
function draftStorageKey() {
  const uid = user && user.id ? user.id : 'anon';
  return DRAFT_PREFIX + uid;
}
function hasDraft() {
  try { return !!localStorage.getItem(draftStorageKey()); } catch (e) { return false; }
}
function readDraft() {
  try {
    const raw = localStorage.getItem(draftStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(draftStorageKey()); } catch (e) { /* 忽略 */ }
  lastDraftSnapshot = '';
}
function draftUnitsSnapshot() {
  return draftUnits.map(u => ({
    recId: u.recId || null,
    sub: u.sub || '',
    date: u.date || '',
    positions: (u.positions || []).map(p => ({
      recId: p.recId || null,
      name: p.name || '',
      base: p.base || '',
      remark: p.remark || '',
      imgs: (p.imgs || []).map(x => (x && x.path ? { path: x.path } : null)).filter(Boolean),
      stage: p.stage || '投递',
      stageDates: { ...(p.stageDates || {}) },
      stageTimes: { ...(p.stageTimes || {}) },
    })),
  }));
}
function buildDraft() {
  const single = draftMode === 'single';
  return {
    mode: draftMode,
    editingId: editingId || null,
    company: single ? ($('#f-company').value || '') : '',
    groupSingle: single ? ($('#f-group-single').value || '') : '',
    groupName: single ? '' : ($('#f-group').value || ''),
    link: $('#f-link').value || '',
    units: draftUnitsSnapshot(),
    stage: draftStage || '投递',
    stageDates: { ...(draftDates || {}) },
    stageTimes: { ...(draftTimes || {}) },
    groupEditStageDates: groupEditStageDates ? { ...groupEditStageDates } : null,
    groupEditStageTimes: groupEditStageTimes ? { ...groupEditStageTimes } : null,
    groupEditStage: groupEditStage || '投递',
    savedAt: Date.now(),
  };
}
// 空草稿不落盘：只判断用户主动填的文本 / 图片；投递日、各阶段日期等有默认值的字段不算「内容」
function draftIsEmpty(d) {
  if (!d) return true;
  if ((d.company || '').trim() || (d.groupSingle || '').trim() || (d.groupName || '').trim() || (d.link || '').trim()) return false;
  for (const u of (d.units || [])) {
    if ((u.sub || '').trim()) return false;
    for (const p of (u.positions || [])) {
      if ((p.name || '').trim() || (p.base || '').trim() || (p.remark || '').trim()) return false;
      if ((p.imgs || []).length) return false;
    }
  }
  return true;
}
function persistDraft() {
  if (!user) return;   // 未登录进不了编辑页，也没有草稿
  let d = null;
  try { d = buildDraft(); } catch (e) { return; }
  if (draftIsEmpty(d)) { clearDraft(); return; }
  const s = JSON.stringify(d);
  if (s === lastDraftSnapshot) return;
  try { localStorage.setItem(draftStorageKey(), s); lastDraftSnapshot = s; } catch (e) { /* 存储满 / 隐私模式，忽略 */ }
}
function startDraftPolling() {
  stopDraftPolling();
  lastDraftSnapshot = '';   // 重新进入编辑页，从头比对
  draftPollTimer = setInterval(persistDraft, 1000);
}
function stopDraftPolling() {
  if (draftPollTimer) { clearInterval(draftPollTimer); draftPollTimer = null; }
}
// 草稿概要（单位数 / 岗位数）：feed 提示条上用，让人一眼知道草稿里填了多少
function draftSummary(d) {
  let pos = 0, units = 0;
  for (const u of (d && d.units) || []) { units++; pos += (u.positions || []).length; }
  return { units, pos };
}
// 恢复草稿：反序列化回表单状态（岗位 key 重新分配、选择范围重置为「全部」），再进编辑页
function restoreDraft(d) {
  draftMode = d.mode === 'group' ? 'group' : 'single';
  editingId = d.editingId || null;
  draftGroup = draftMode === 'group' ? (d.groupName || '') : (d.groupSingle || '');
  draftUnits = (d.units || []).map(u => ({
    key: nextKey('u'), recId: u.recId || null, sub: u.sub || '', date: u.date || '',
    positions: (u.positions || []).map(p => ({
      key: nextKey('p'), recId: p.recId || null, name: p.name || '', base: p.base || '', remark: p.remark || '',
      imgs: (p.imgs || []).map(x => ({ path: x.path })),
      stage: p.stage || '投递', stageDates: { ...(p.stageDates || {}) }, stageTimes: { ...(p.stageTimes || {}) },
    })),
  }));
  if (!draftUnits.length) draftUnits = [newUnit()];
  draftStage = d.stage || '投递';
  draftDates = { ...(d.stageDates || {}) };
  draftTimes = { ...(d.stageTimes || {}) };
  stageScope = null;
  groupEditStageDates = d.groupEditStageDates ? { ...d.groupEditStageDates } : null;
  groupEditStageTimes = d.groupEditStageTimes ? { ...d.groupEditStageTimes } : null;
  groupEditStage = d.groupEditStage || '投递';
  draftScratch = { company: d.company || '', groupSingle: d.groupSingle || '', groupName: d.groupName || '', link: d.link || '' };
  restoringDraft = true;
  if (overlayKind === 'sheet') closeSheet();
  showView('edit');
  overlayOpen('edit');
}

function renderEdit() {
  if (restoringDraft) { renderEditFromDraft(); return; }
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
  stageScope = null;   // 每次进入编辑页都从「应用到全部岗位」开始，上次的选择（岗位 key 已换新）不残留
  // 阶段缓冲区：编辑时取原记录的日期，新增默认「投递」日为今天（newPosition 会把这份缓冲带给新岗位）
  draftDates = rec && rec.stage_dates ? { ...rec.stage_dates }
    : (rec ? {} : { '投递': todayStr() });
  draftTimes = rec && rec.stage_dates_at ? { ...rec.stage_dates_at } : {};
  draftStage = stageFromDates(draftDates) || (rec ? rec.stage : '投递');
  // 集团模式：编辑时这条记录成为一张单位卡（一个岗位）；老数据 company 可能是全称（如 中信银行北京市分行），回填到具体单位
  if (draftMode === 'group') {
    draftUnits = rec
      ? [{
          key: nextKey('u'), recId: rec.id,
          sub: rec.sub_unit || (rec.company !== rec.group_name ? rec.company : '') || '',
          date: (rec.stage_dates && rec.stage_dates['投递']) || '',
          // 岗位带上原记录 id：保存时这条走 update，本次新增的岗位行走 insert；
          // 阶段也带回岗位自己（集团模式下阶段同样按岗位独立填写）
          positions: [{ key: nextKey('p'), recId: rec.id, name: rec.position || '', base: rec.base || '', remark: rec.remark || '', imgs: imgsOf(rec),
            stage: rec.stage || '投递', stageDates: rec.stage_dates ? { ...rec.stage_dates } : {},
            stageTimes: rec.stage_dates_at ? { ...rec.stage_dates_at } : {} }],
        }]
      : [newUnit()];
    // 编辑已有记录：保留其原有各阶段日期（兜底给「集团主体」空卡），新增则从空开始
    groupEditStageDates = rec && rec.stage_dates ? { ...rec.stage_dates } : null;
    groupEditStageTimes = rec && rec.stage_dates_at ? { ...rec.stage_dates_at } : null;
    groupEditStage = rec ? (rec.stage || '投递') : '投递';
  } else {
    // 单个单位模式：单位 / 链接在外层共用字段上；Base / 备注 / 阶段挂在岗位行里，这里只需要装岗位。
    // 阶段按岗位初始化：编辑时带回原记录的 stage / stage_dates，新增默认「投递 = 今天」
    draftUnits = [{
      key: nextKey('u'), recId: rec ? rec.id : null,
      positions: [{ key: nextKey('p'), recId: rec ? rec.id : null, name: rec ? (rec.position || '') : '', base: rec ? (rec.base || '') : '', remark: rec ? (rec.remark || '') : '', imgs: rec ? imgsOf(rec) : [],
        stage: rec ? (rec.stage || '投递') : '投递',
        stageDates: rec ? { ...(rec.stage_dates || {}) } : { '投递': todayStr() },
        stageTimes: rec ? { ...(rec.stage_dates_at || {}) } : {} }],
    }];
    groupEditStageDates = null;
    groupEditStageTimes = null;
    groupEditStage = '投递';
  }
  renderUnits();
  renderPositions(draftUnits[0], $('#single-positions'));
  $('#f-group').value = initGroup;
  $('#f-group-single').value = singleTagged ? initGroup : (draftMode === 'single' ? initGroup : '');
  $('#group-list').innerHTML = groupNameOptions().map(g => `<option value="${esc(g)}">`).join('');
  $('#f-company').value = rec ? rec.company : '';
  // 批量粘贴入口复位
  setBatchMode(false);
  $('#f-link').value = rec ? (rec.link || '') : '';
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] + ';color:#fff' : ''}" role="button" tabindex="0">${s}</span>`).join('');
  renderDateRows();
  // 每次进入编辑页都把行内错误与日期折叠区复位
  clearAllErrors();
  $('#dates-toggle').setAttribute('aria-expanded', 'false');
  $('#edit-dates').classList.add('hidden');
  updateGroupHint();
  $('#btn-discard-draft').classList.toggle('hidden', !hasDraft());
  startDraftPolling();
}
// 从草稿恢复进入编辑页：状态已在 restoreDraft 里回填好，这里只把 DOM 渲染出来，不再走默认初始化
function renderEditFromDraft() {
  restoringDraft = false;
  const rec = editingId ? records.find(r => r.id === editingId) : null;
  $('#edit-title').textContent = rec ? '编辑投递' : '继续填写';
  $('#btn-delete').classList.toggle('hidden', !rec);
  setModeUI(draftMode);
  renderUnits();
  renderPositions(draftUnits[0], $('#single-positions'));
  $('#f-group').value = draftMode === 'group' ? (draftScratch.groupName || '') : '';
  $('#f-group-single').value = draftMode === 'single' ? (draftScratch.groupSingle || '') : '';
  $('#group-list').innerHTML = groupNameOptions().map(g => `<option value="${esc(g)}">`).join('');
  $('#f-company').value = draftScratch.company || '';
  setBatchMode(false);
  $('#f-link').value = draftScratch.link || '';
  $('#edit-stages').innerHTML = ALL_STAGES.map(s =>
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] + ';color:#fff' : ''}" role="button" tabindex="0">${s}</span>`).join('');
  renderDateRows();
  clearAllErrors();
  $('#dates-toggle').setAttribute('aria-expanded', 'false');
  $('#edit-dates').classList.add('hidden');
  updateGroupHint();
  $('#btn-discard-draft').classList.toggle('hidden', !hasDraft());
  startDraftPolling();
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
  // 阶段区（chips + 选中圈）两种模式共用：集团模式下同样按岗位圈选批量写
  $('#row-stage').classList.remove('hidden');
  $('#row-dates').classList.toggle('hidden', isGroup);
  if (isGroup) {
    if (!draftUnits.length) draftUnits = [newUnit()];
    // 从单模式切过来的单位卡没有 date 字段（单模式没有投递日输入）：补默认今天，否则落库会丢投递日
    for (const u of draftUnits) if (u.date === undefined) u.date = todayStr();
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
          <div class="p-hint p-hint-sec">Base 地、岗位描述与阶段按岗位填写，每个岗位各自独立</div>
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
  // 阶段徽章与选中圈在岗位总数 > 1 时出现（单模式看本单位，集团模式看全部单位卡的岗位总数）：
  // 单岗位时阶段区就在下方、直接应用到它，不需要选择入口
  const totalPos = draftUnits.reduce((n, u2) => n + u2.positions.length, 0);
  const showStage = totalPos > 1;
  container.classList.toggle('has-sel', showStage);
  container.innerHTML = unit.positions.map((p, i) => `
    <div class="p-item">
      <div class="p-top">
        ${selCircleHTML(p, i, showStage)}
        <input class="pi-name" data-uk="${unit.key}" data-pk="${p.key}" maxlength="40"
               placeholder="如 AI 应用开发岗" aria-label="岗位名称 ${i + 1}" value="${esc(p.name || '')}">
        <input class="pi-base" data-uk="${unit.key}" data-pk="${p.key}" data-pb="1" list="base-list" maxlength="30"
               placeholder="Base 地，如 成都 / 石家庄、雄安新区" aria-label="岗位 ${i + 1} 的 Base 地" value="${esc(p.base || '')}">
        <button type="button" class="pi-del" data-uk="${unit.key}" data-pdel="${p.key}"
                ${unit.positions.length <= 1 ? 'hidden' : ''} aria-label="删除该岗位">×</button>
      </div>
      ${showStage ? `<div class="p-stage-line"><span class="pi-stage" data-stage-pk="${p.key}" style="background:${COLORS[posStageOf(p)] || '#9AA0A6'}">${esc(posStageOf(p))}</span></div>` : ''}
      <div class="p-line p-desc-line">
        <textarea class="pi-remark" data-uk="${unit.key}" data-pk="${p.key}" data-pr="1" rows="1"
                  placeholder="岗位描述，如：做 AI 应用后端，Java + 微服务" aria-label="岗位 ${i + 1} 的岗位描述">${esc(p.remark || '')}</textarea>
        ${imgAddBtnHTML(unit, p, i)}
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
  updateScopeIndicator();   // 岗位增删后刷新范围指示（显隐 / 文案）
  container.querySelectorAll('.pi-remark').forEach(autoGrowRemark);   // 已有长描述按内容对齐高度
  hydrateImages(container);   // 附件走签名 URL：渲染完统一回填 src
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
  if (room <= 0) { toast(`每个岗位最多 ${MAX_IMGS_PER_POS} 个附件`, 'error'); return; }
  const list = [...files].slice(0, room);
  if (files.length > room) toast(`超过上限，只上传前 ${room} 个`, 'error');
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
  if (done) toast(`已上传 ${done} 个附件`, 'success');
  if (done + failed === list.length && failed) toast(`${failed} 个上传失败`, 'error');
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
    imgViewer.innerHTML = '<img alt="附件"><button type="button" class="iv-x" aria-label="关闭">×</button>';
    document.body.appendChild(imgViewer);
    imgViewer.addEventListener('click', (e) => {
      if (e.target === imgViewer || e.target.closest('.iv-x')) closeImageViewer();
    });
  }
  imgViewer.querySelector('img').src = src;
  imgViewer.classList.remove('hidden');
}
function closeImageViewer() { if (imgViewer) imgViewer.classList.add('hidden'); }
// 岗位描述框右侧的小图片按钮：只占一个 36px 方块，加图入口不另起一行
function imgAddBtnHTML(unit, p, i) {
  if ((p.imgs || []).length >= MAX_IMGS_PER_POS) return '';
  return `<button type="button" class="p-img-add" data-uk="${unit.key}" data-pk="${p.key}" data-imgadd="1"
     title="添加附件" aria-label="给岗位 ${i + 1} 添加附件">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.6" cy="10" r="1.5"/>
      <path d="M4.2 17.4l4.6-4.6 3.4 3.4 3-3 4.6 4.6"/>
    </svg><span class="p-img-add-plus" aria-hidden="true">＋</span>
  </button>`;
}
function imgStripHTML(unit, p, i) {
  const imgs = p.imgs || [];
  if (!imgs.length) return '';
  return `<div class="p-imgs">
    ${imgs.map((im, k) => `<span class="p-img">
      <img data-path="${esc(im.path)}" alt="附件 ${k + 1}" loading="lazy">
      <button type="button" class="p-img-x" data-uk="${unit.key}" data-pk="${p.key}" data-imgdel="${k}"
              aria-label="删除这张附件">×</button>
    </span>`).join('')}
    <span class="p-img-tip">${imgs.length}/${MAX_IMGS_PER_POS}</span>
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
  // 选中集合里同步摘掉被删的岗位，避免残留 key 让「全选」判断失真
  if (stageScope && stageScope.has(posKey)) { stageScope = new Set(stageScope); stageScope.delete(posKey); updateScopeIndicator(); }
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
// 改岗位名：只写状态，不做实时查重 —— 同名不同 Base 是合法场景（如「软件研发员」在广州、成都各投一次），
// 实时拦截会在名字打到与已有岗位相同的瞬间清空输入框，导致后缀/Base 补不上去；真正的重复（同名同 Base）
// 由保存时的去重处理（见 doSaveSingleRecord 的 seen 键：岗位名 + Base + 备注，三者全同才算重复）
function editPositionName(u, posKey, value) {
  const p = u.positions.find(x => x.key === posKey);
  if (!p) return;
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
// 描述框默认只占一行高的普通输入框大小，内容真放不下才按需长高（最多约 3 行），不默认撑成大方块
function autoGrowRemark(el) {
  if (!el || el.dataset.pr === undefined) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
function removeUnit(unitKey) {
  if (draftUnits.length <= 1) return;
  const idx = draftUnits.findIndex(u => u.key === unitKey);
  if (idx < 0) return;
  const u = draftUnits[idx];
  const saved = u.positions.filter(p => p.recId).length;
  if (saved && !confirm(`该单位下有 ${saved} 条已保存的投递，删除会一并移除，确定？`)) return;
  // 选中集合里同步摘掉该单位下所有岗位，避免残留 key
  if (stageScope) {
    const keys = new Set(u.positions.map(p => p.key));
    const next = new Set([...stageScope].filter(k => !keys.has(k)));
    stageScope = next.size ? next : null;
    updateScopeIndicator();
  }
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
  // 时间只在填了日期的阶段上有意义，没填日期的行不给时间控件（半透明置灰，避免误填）
  $('#edit-dates').innerHTML = ALL_STAGES.map(s => {
    const hasDate = !!draftDates[s];
    return `
    <div class="date-row">
      <div class="date-name"><span class="date-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input type="date" class="date-picker" data-dp="${s}" data-skip="${dateSkip.has('dp:' + s) ? '1' : ''}" value="${draftDates[s] ? esc(draftDates[s]) : ''}">
      ${hasDate ? timeSelectHTML(`data-dt="${s}"`, draftTimes[s])
        : '<button type="button" class="time-locked" data-dt-need="' + s + '" title="先填日期，再填具体时间">时间</button>'}
      <div class="date-acts">
        <button type="button" class="date-act" data-today="${s}">今日</button>
        <button type="button" class="date-act" data-yesterday="${s}">昨天</button>
        <button type="button" class="date-act clear" data-clear="${s}">清除</button>
      </div>
    </div>`;
  }).join('');
  // 折叠标题上显示已填项数，不用展开就能看到有没有填
  const n = ALL_STAGES.filter(s => String(draftDates[s] || '').trim()).length;
  const meta = $('#dates-meta');
  if (meta) meta.textContent = n ? `已填 ${n} 项` : '未填写';
}

// ---------- 岗位级阶段：应用范围 + 批量写入 ----------
// 每个岗位自带 stage / stageDates（与落库字段一一对应）；「当前阶段」区只是往目标岗位批量写入的工具。
// 写入规则与原全局行为一致：日期是唯一事实来源，阶段由已填日期里最晚的推导，推导不出退回手选值。
function posStageOf(p) { return stageFromDates(p.stageDates) || p.stage || '投递'; }
// 阶段作用域覆盖的岗位全集：单模式 = 第一个单位的岗位；集团模式 = 所有单位卡下的岗位
function allStagePositions() {
  if (draftMode === 'group') return draftUnits.flatMap(u => u.positions || []);
  return draftUnits[0] ? draftUnits[0].positions : [];
}
// 阶段 / 日期改动要写到哪些岗位：null = 全部；否则取勾选且仍存在的岗位（删岗后集合自动收缩）
function stageScopeTargets() {
  const list = allStagePositions();
  if (!stageScope) return list;
  return list.filter(p => stageScope.has(p.key));
}
// 点阶段 chip = 「当前阶段切到这个阶段」：清掉流程上位于它之后的已记日期。
// 否则同一天先点 Offer 再点三面时，两个日期都是今天，stageFromDates 按「同日取流程靠后」
// 永远推导回 Offer，徽章和落库都切不回去。清掉之后的阶段日期，推导自然落回点选的阶段
function pruneLaterStageDates(stage) {
  const idx = ALL_STAGES.indexOf(stage);
  if (idx < 0) return false;
  let changed = false;
  for (const s of ALL_STAGES.slice(idx + 1)) {
    if (draftDates[s]) { delete draftDates[s]; changed = true; }
    if (draftTimes[s]) { delete draftTimes[s]; changed = true; }   // 日期没了，挂在它上面的时间一并清掉
  }
  return changed;
}
// 应用范围变化后，阶段区（chips + 日期行）回显第一个目标岗位的数据：看到的就是接下来要写到的
function syncBufferFromScope() {
  const ts = stageScopeTargets();
  if (!ts.length) return;
  const p = ts[0];
  draftDates = { ...(p.stageDates || {}) };
  draftTimes = { ...(p.stageTimes || {}) };
  draftStage = stageFromDates(draftDates) || p.stage || '投递';
  renderDateRows();
  renderEditStagesOnly();
}
// 把阶段区的当前内容（draftStage + draftDates + draftTimes）整份写到目标岗位，并刷新岗位行上的阶段徽章
function applyBufferToTargets() {
  for (const p of stageScopeTargets()) {
    p.stageDates = { ...draftDates };
    p.stageTimes = { ...draftTimes };
    p.stage = stageFromDates(draftDates) || draftStage || '投递';
  }
  refreshPosStageBadges();
}
function refreshPosStageBadges() {
  for (const p of allStagePositions()) {
    const el = document.querySelector(`[data-stage-pk="${p.key}"]`);
    if (!el) continue;
    const s = posStageOf(p);
    el.textContent = s;
    el.style.background = COLORS[s] || '#9AA0A6';
  }
}
// 岗位卡左侧的选中圈：多岗位时替代序号圆，是阶段应用范围的选择入口。
// all=未进入选择（数字圆，= 全部岗位）；on=选中；off=未选中（虚线空心圈）
function selCircleHTML(p, i, showSel) {
  if (!showSel) return `<span class="pi-idx">${i + 1}</span>`;
  const on = !!stageScope && stageScope.has(p.key);
  const off = !!stageScope && !on;
  const cls = off ? 'off' : (on ? 'on' : 'all');
  const content = on ? '✓' : (i + 1);
  return `<button type="button" class="pi-idx pi-sel ${cls}" data-psel="${p.key}" data-pidx="${i + 1}" aria-pressed="${on}" aria-label="选中岗位 ${i + 1}，阶段将更新到选中的岗位">${content}</button>`;
}
// 点圈切换选中状态，只原地改圈的样式，不重渲染岗位列表（保输入焦点）。
// 语义：圈是独立开关——没选过（null）→ 点圈从「全部」进入显式选择，先选这一个；
// 之后每点一次就是勾上 / 取消这一个；空集和全选都保留为显式集合，不折叠回 null
//（否则「点1→点2→再点2」会因全选折叠导致再次点圈时语义跳变）
function toggleScopePosition(pk) {
  if (!allStagePositions().length) return;
  if (!stageScope) stageScope = new Set([pk]);
  else {
    stageScope = new Set(stageScope);
    if (stageScope.has(pk)) stageScope.delete(pk); else stageScope.add(pk);
  }
  syncBufferFromScope();
  refreshScopeCircles();
  updateScopeIndicator();
}
function refreshScopeCircles() {
  for (const p of allStagePositions()) {
    const el = document.querySelector(`[data-psel="${p.key}"]`);
    if (!el) continue;
    const on = !!stageScope && stageScope.has(p.key);
    const off = !!stageScope && !on;
    el.className = 'pi-idx pi-sel ' + (off ? 'off' : (on ? 'on' : 'all'));
    el.textContent = on ? '✓' : Number(el.dataset.pidx || 1);
    el.setAttribute('aria-pressed', String(on));
  }
}
// 范围指示：只读反馈阶段当前写到哪些岗位；点击恢复全部。岗位总数 ≤1 时隐藏并复位
function updateScopeIndicator() {
  const el = $('#scope-indicator');
  if (!el) return;
  const all = allStagePositions();
  const multi = all.length > 1;
  el.classList.toggle('hidden', !multi);
  // 提示文案跟随岗位数：多岗位才讲「圆圈选中」，单岗位直接说阶段应用到它，避免单岗位时出现无从下手的指引
  const hint = $('#stage-hint');
  if (hint) hint.textContent = multi
    ? '点选阶段即记为今天；多个岗位想填不同阶段，先点岗位左侧的圆圈选中，再选阶段'
    : '点选阶段即记为今天，直接应用到当前岗位';
  if (!multi) { stageScope = null; return; }
  // 指示文案：显式全选 / 未进入选择（null）都算「全部岗位」；空集 = 未选；其余 = 已选 N 个
  const n = stageScopeTargets().length;
  if (!stageScope || n === all.length) { el.textContent = '全部岗位'; el.classList.remove('partial'); }
  else if (!n) { el.textContent = '未选岗位'; el.classList.add('partial'); }
  else { el.textContent = `已选 ${n} 个岗位`; el.classList.add('partial'); }
}
function collectForm() {
  // Base 地 / 岗位描述 / 阶段都按岗位走：collectForm 只管整单共用的字段（单位 / 集团 / 链接）。
  // 单个单位模式不再写 sub_unit（该字段只由集团投递模式的单位行填充）——
  // 不在这里带 sub_unit，编辑已有记录时也就不会把历史值清空。
  return {
    company: $('#f-company').value.trim(),
    group_name: draftMode === 'group'
      ? ($('#f-group').value.trim() || null)
      : ($('#f-group-single').value.trim() || null),
    link: $('#f-link').value.trim() || null,
    update_time: new Date().toISOString(),
  };
}
// 单条记录的阶段载荷：stage_dates 取岗位自己的，阶段由日期推导（推导不出退回手选值）。
// stage_dates_at 只保留「既有日期又有时间」的项，避免日期被清掉后留下孤立的垃圾时间。
function stageTimesOf(p) {
  const times = {};
  const dates = p.stageDates || {};
  for (const [s, t] of Object.entries(p.stageTimes || {})) {
    const v = cleanTime(t);
    if (v && dates[s]) times[s] = v;
  }
  return times;
}
function stagePayloadOf(p) {
  const stage_dates = { ...(p.stageDates || {}) };
  return {
    stage: stageFromDates(stage_dates) || p.stage || '投递',
    stage_dates,
    stage_dates_at: stageTimesOf(p),
    apply_date: stage_dates['投递'] || null,
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
// ---------- 岗位信息智能识别（粘贴文本 → 字段） ----------
// 四层递进、命中即停；认不出来就留空，绝不猜：
//   1) 标签式：出现「公司：」「岗位：」「工作地点：」这类带冒号的字段名，直接采信
//   2) 已知库：拿全文去匹配历史填过的单位名 / 岗位名（datalist 候选），命中即确定
//   3) 启发式：公司后缀、岗位关键词、地名表（复用 matchCity / normalizeLocation）
//   4) 兜底留空
// 结果一律先出可编辑预览，确认后才写入表单 —— 这是准确率最后的保险。
// 段标题词表：一份词表同时生成「标题行」和「标题 + 同行值」两种正则，
// 所以行序乱、标题带不带冒号、值和标题在同一行还是换行，都能归到同一个字段。
// 长词必须排在短词前面（JS 正则的 | 是最左优先匹配）。
const SMART_SECTION_WORDS = [
  { key: 'company',     w: '公司名称|单位名称|企业名称|招聘机构|招聘公司|招聘单位|用人单位|用工单位|投递单位|招聘企业|公司名|单位名|招聘方|公司|单位|企业' },
  { key: 'position',    w: '岗位名称|职位名称|应聘岗位|招聘岗位|投递岗位|招聘方向|岗位方向|岗位|职位' },
  { key: 'base',        w: '工作地点|工作城市|办公地点|工作地|地点|城市|base|Base|BASE' },
  { key: 'duty',        w: '岗位职责|职位描述|岗位描述|工作内容|工作职责|主要职责|职责描述|职责|JD|jd' },
  { key: 'requirement', w: '岗位要求|任职要求|职位要求|应聘要求|任职资格|任职条件|应聘条件|招聘条件|岗位条件|要求|条件' },
  { key: 'salary',      w: '薪资范围|薪酬范围|薪资水平|薪酬福利|薪资|薪酬|待遇|工资|月薪|年薪' },
  { key: 'headcount',   w: '招聘人数|招录人数|需求人数|招聘数量|招录名额|人数|名额' },
  { key: 'contact',     w: '联系方式|联系电话|联系邮箱|投递邮箱|简历投递|投递方式|联系人' },
  { key: 'deadline',    w: '网申截止日期|投递截止日期|报名截止日期|网申截止时间|网申截止|投递截止|报名截止|招聘截止|截止日期|截止时间|网申时间|报名时间' },
];
const SMART_SECTIONS = SMART_SECTION_WORDS.map(s => ({
  key: s.key,
  title: new RegExp('^(?:' + s.w + ')\\s*[:：]?$'),          // 「岗位职责」独占一行
  inline: new RegExp('^(?:' + s.w + ')\\s*[:：]\\s*(.+)$'),  // 「工作地点：南昌」
}));
// 岗位名里的噪声：薪资段、学历、经验年限、常见福利词
const SMART_POS_WORD = /(工程师|研发|开发|算法|前端|后端|全栈|测试|运维|数据|产品|运营|设计|销售|市场|人事|人力|财务|法务|行政|嵌入式|安卓|Android|iOS|Java|Python|Golang|Go语言|C\+\+|大模型|机器学习|视觉|语音|NLP|自然语言处理|推荐|搜索|风控|安全|实习生|专员|主管|经理|总监|架构师|专家|顾问|分析师|设计师|助理|研究员|人才|专项|管培|培训生|储备|岗位)/;
const SMART_CO_SUFFIX = '(?:股份有限公司|有限责任公司|有限公司|集团公司|集团|研究院|研究所|设计院|银行|保险|证券|基金|信托|事务所|大学|学院|学校|医院|中心)';
const SMART_BRACKET_NOISE = /^(?:急招|急聘|招聘|内推|校招|社招|全职|兼职|实习|远程|线下|线上|最新|置顶|热门|官方|直招)$/;
// 整行都是网页界面文字，不是岗位内容（「繁体/ENGLISH」这种语言切换）
const SMART_UI_LINE = /^(?:繁体|简体|中文|ENGLISH|English|english|EN|CN)(?:\s*[/|｜]\s*(?:繁体|简体|中文|ENGLISH|English|english|EN|CN))*$/;
// 招聘网页里常把按钮文字混进正文（「南昌市收藏岗位应聘岗位」「…查看机构主页」）
const SMART_UI_NOISE = /(查看机构主页|查看公司主页|查看职位详情|查看主页|收藏职位|收藏岗位|应聘岗位|申请职位|立即投递|投简历|加入收藏|关注企业|查看详情|返回列表|一键投递|职位详情|机构主页)/g;
// 要点提炼：太短的碎片不要，过长的按分句截到 120 字，最多 8 条
const SMART_BULLET_MIN = 4, SMART_BULLET_MAX = 120, SMART_BULLET_LIMIT = 8;
// 营销话术：整句去掉这些词后剩下的内容不足 8 字，说明这条没有实质信息
const SMART_MARKETING = /(团队氛围|公司福利|员工福利|福利待遇|发展空间|晋升空间|扁平管理|大牛|零食|下午茶|团建|定期体检|带薪年假|节日福利|五险一金|免费班车|餐补|房补|交通补助|股票期权|期权激励|弹性工作|行业领先|朝阳行业|独角兽|上市公司|氛围好|平台大|前景广阔|欢迎加入|期待你|快来投递|心动不如行动|简历直达|扫码|加微信|关注公众号|公众号)/;
// 引导句：「在符合…公告的基础上，还应满足以下要求：」这类句子本身没有实质要求
const SMART_LEAD_IN = /^(?:在|根据|依据|按照|结合)[\s\S]{0,60}(?:应满足|须满足|满足以下|符合以下|如下|以下)(?:要求|条件)?$/;
const SMART_SALARY_RE = /(?:\d+(?:\.\d+)?\s*[-~－—至到]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:[kKwW]|千|万|元)\s*(?:[-~至到]\s*\d+(?:\.\d+)?\s*(?:[kKwW]|千|万|元))?\s*(?:\/\s*(?:月|年|天|时))?(?:\s*[·•]\s*\d{1,2}\s*薪)?/;
const SMART_HEADCOUNT_RE = /\d+\s*[-~至到]\s*\d+\s*(?:人|名)|\d+\s*(?:人|名)(?:左右|以上|以内)?/;
const SMART_EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const SMART_PHONE_RE = /(?:^|\D)(1[3-9]\d{9})(?:\D|$)/;   // 前后必须不是数字，避免切到长数字串里
const SMART_DATE_RE = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/;
// 既不属于固定字段、又确实是招聘关键信息的标签，收进 extra
const SMART_EXTRA_WORDS = /^(?:所属部门|汇报对象|用工形式|工作性质|职位类别|岗位类别|招聘类型|招聘对象|面向对象|招聘形式|编制|岗位职级|职级)$/;

function smartStripNoise(s) {
  let out = String(s || '');
  out = out.replace(/\d+\s*[-~至到]\s*\d+\s*年(?:以上)?(?:经验)?/g, ' ');
  out = out.replace(/\d+\s*年(?:以上)?经验/g, ' ');
  out = out.replace(/经验不限|无需经验/g, ' ');
  out = out.replace(/\d+\s*[-~至到]\s*\d+\s*[kKwW千万]?/g, ' ');
  out = out.replace(/\d+\s*[kKwW千万]\s*(?:以上|起)?/g, ' ');
  out = out.replace(/(博士|硕士|研究生|本科|大专|专科)(及以上|或以上|以上)?/g, ' ');
  out = out.replace(/(五险一金|周末双休|双休|弹性工作|年终奖|餐补|房补|交通补助|免费班车)/g, ' ');
  out = out.replace(/[·•|｜]+/g, ' ');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out.replace(/^[\s，,。;；、/|-]+|[\s，,。;；、/|-]+$/g, '').trim();
}
// 长段落切成短片段，便于逐段判断它更像岗位名还是地名
function smartSegments(text) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const l = line.trim();
    if (!l) continue;
    if (l.length <= 40) { out.push(l); continue; }
    for (const p of l.split(/[。；;！？!?]+/)) { const s = p.trim(); if (s) out.push(s); }
  }
  return out;
}
// 第 1 层：按段标题归类。标题后的内容一直归到下一个标题为止，
// 所以「岗位职责：」后面换行写 3 段、或者混着编号列表，都会被收进同一个字段。
function smartSplitSections(lines) {
  const sec = {}, head = [];
  let cur = '';
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    let key = null, val = '';
    for (const S of SMART_SECTIONS) {
      const m = line.match(S.inline);
      if (m) { key = S.key; val = (m[1] || '').trim(); break; }
      if (S.title.test(line)) { key = S.key; val = ''; break; }
    }
    if (key) {
      cur = key;
      (sec[key] = sec[key] || []).push(val);   // 值可能为空（标题独占一行），后面行会补进来
      continue;
    }
    if (cur) sec[cur].push(line); else head.push(line);
  }
  return { sec, head };
}
// 取值：删掉网页按钮噪声，去掉「A - B」里的冗余分支，收尾标点一并清掉
function smartValue(s) {
  const v = String(s || '').replace(SMART_UI_NOISE, ' ').replace(/[·•｜|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return v.replace(/^[\s，,。;；:：/|-]+|[\s，,。;；:：/|-]+$/g, '').trim();
}
// 单位名里「江西省分行 - 江西省分行本部」这种并列分支只取前一段
function smartFirstBranch(s) {
  const parts = String(s || '').split(/\s+[-—–]\s+|、/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[0] : '';
}
// 在编号前插入分隔符：1. / （1） / ① 都认，行首或标点后的才算编号（避免切坏「2026年1月」）
function smartMarkNumbered(line) {
  return line.replace(
    /(^|[\s，,。；;：:、])((?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[.、．)）]|[①②③④⑤⑥⑦⑧⑨⑩]))/g,
    '$1\u0001$2');
}
function smartBulletClean(s) {
  let t = String(s || '').trim();
  t = t.replace(/^[（(]\s*\d{1,2}\s*[)）]\s*/, '').replace(/^\d{1,2}\s*[.、．)）]\s*/, '')
       .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').replace(/^[-•·*｜|]\s*/, '');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^[\s，,。;；、:：]+|[\s，,。;；、:：]+$/g, '').trim();
  // 「…具有良好的外语沟通能力，具体要求如下」→ 尾巴上的「具体要求如下」没有信息量
  return t.replace(/[，,]?\s*(?:具体要求|要求|条件)?(?:如下|以下)$/, '').trim();
}
// 营销句判定：看营销词占了整句多少篇幅，而不是看句子长短
// ——「后端开发工程师」只有 7 个字但内容实在，不能因为短就当成空话。
function smartIsMarketing(s) {
  const plain = s.replace(/[\s，,。;；、·|/]+/g, '');
  if (!plain) return true;
  const rest = s.replace(new RegExp(SMART_MARKETING.source, 'g'), '')
                .replace(/[\s，,。;；、·|/]+/g, '');
  if (!rest) return true;                                   // 整句全是营销词
  // 去掉营销词后只剩「我们 / 你 / 加入」这类虚词，也是空话（「我们期待你的加入」）
  if (rest.replace(/(我们|你们|你|我|的|了|和|与|及|等|欢迎|期待|加入|快来|心动)/g, '').length < 3) return true;
  if (plain.length > 40) return false;                      // 长句里夹一两个福利词不叫空话
  return (plain.length - rest.length) / plain.length >= 0.5; // 一半以上篇幅是营销词
}
// 段内整行过滤：招聘网页常把「我们期待你的加入」这类话混进正文
function smartCleanLines(arr) {
  return (arr || []).map(s => String(s || '').trim()).filter(s => s && !smartIsMarketing(s));
}
// 超长要点按分句截，保证截出来的仍是完整分句，不会读到一半
function smartClip(s, max) {
  if (s.length <= max) return s;
  let out = '';
  for (const p of s.split(/[，,；;]/)) {
    if ((out + p).length > max) break;
    out += (out ? '，' : '') + p;
  }
  return out || s.slice(0, max);
}
// 一段文字 → 简洁要点数组：按编号切 → 按句切 → 去营销 / 去引导句 / 去重 / 限长
function smartBullets(text, limit) {
  const out = [], seen = new Set();
  for (const line of String(text || '').split(/\n+/)) {
    for (const chunk of smartMarkNumbered(line.trim()).split('\u0001')) {
      for (const sent of chunk.split(/[。；;！!？?\n]+/)) {
        let b = smartBulletClean(sent);
        if (b.length < SMART_BULLET_MIN) continue;
        if (SMART_UI_LINE.test(b)) continue;                       // 网页界面文本（语言切换等）
        if (smartIsMarketing(b) || SMART_LEAD_IN.test(b)) continue;
        b = smartClip(b, SMART_BULLET_MAX);
        const k = b.replace(/[\s，,。;；、:：()（）]/g, '');
        if (seen.has(k)) continue;
        seen.add(k); out.push(b);
      }
    }
  }
  return out.slice(0, limit || SMART_BULLET_LIMIT);
}
function smartPickSalary(s) {
  const m = String(s || '').match(SMART_SALARY_RE);
  return m ? m[0].trim().slice(0, 40) : '';
}
function smartPickHeadcount(s) {
  const m = String(s || '').match(SMART_HEADCOUNT_RE);
  return m ? m[0].trim() : '';
}
function smartPickContact(s) {
  const t = String(s || '');
  const hits = [];
  const em = t.match(SMART_EMAIL_RE); if (em) hits.push(em[0]);
  const ph = t.match(SMART_PHONE_RE); if (ph) hits.push(ph[1]);
  const wx = t.match(/(?:微信|WeChat|wechat|WX)\s*[:：]?\s*([A-Za-z0-9_-]{5,20})/); if (wx) hits.push('微信：' + wx[1]);
  return hits.join(' / ').slice(0, 60);
}
// 日期归一成 YYYY-MM-DD（原文只写「10月8日」时缺年份，就按原文保留不补）
function smartPickDate(s) {
  const m = String(s || '').match(SMART_DATE_RE);
  if (!m) return '';
  const mm = String(Number(m[2])).padStart(2, '0'), dd = String(Number(m[3])).padStart(2, '0');
  return m[1] + '-' + mm + '-' + dd;
}
// 第 2 层：历史填过的单位 / 岗位（datalist 候选），取最长的那条命中
function smartKnown(sel, text, minLen) {
  let best = '';
  document.querySelectorAll(sel + ' option').forEach(o => {
    const v = String(o.value || '').trim();
    if (v.length < minLen || !text.includes(v)) return;
    if (v.length > best.length) best = v;
  });
  return best;
}
// 第 3 层 A：公司后缀（「…有限公司」「…研究所」「…银行」）
function smartGuessCompany(segs, body) {
  // 字符集里必须排除冒号，否则会把「招聘计划：中国建设银行」连在一起当成公司名
  const re = new RegExp('[^\\s，。；、:：|()（）【】「」\\[\\]]{2,40}' + SMART_CO_SUFFIX);
  const m = body.match(re);
  if (m) {
    const v = m[0].replace(/^(?:招聘单位|用人单位|公司名称|单位名称|企业名称|集团名称|公司|单位|投递|岗位|职位)+/, '');
    return smartStripNoise(v);
  }
  return '';
}
// 第 3 层 C：方括号里的名字。放在后缀和首个短段之后，否则会抢走「字节跳动【抖音电商】」里的真公司名
function smartGuessCompanyBracket(body) {
  const br = String(body || '').match(/[【\[「]([^】\]」]{2,40})[】\]」]/);
  if (!br) return '';
  const v = smartStripNoise(br[1]);
  if (!v || SMART_BRACKET_NOISE.test(v) || SMART_POS_WORD.test(v)) return '';
  return v;
}
// 第 3 层 B：招聘文本里公司名通常是第一个「不含岗位词、不含地名、不含冒号」的短段
function smartGuessCompanyFirst(segs) {
  const pick = (l) => {
    if (l.length < 2 || l.length > 20) return '';
    if (!/[\u4e00-\u9fa5]/.test(l)) return '';        // 至少一个汉字，否则纯噪声也会被当成公司名
    if (SMART_POS_WORD.test(l) || matchCity(l) || /[:：]/.test(l) || /^\d/.test(l)) return '';
    if (SMART_MARKETING.test(l)) return '';
    return l.replace(/(?:诚聘|招聘|招募|热招)$/, '');
  };
  for (const seg of segs) {
    const l = String(seg || '').trim()
      .replace(/[【\[「][^】\]」]*[】\]」]/g, ' ')      // 去掉「【抖音电商】」这类方括号内容
      .replace(/^(?:急招|急聘|招聘|校招|社招|内推|热招|诚聘|诚邀)\s*[!！:：\s]*/, '')
      .replace(/\s{2,}/g, ' ').trim();
    const v = pick(l);
    if (v) return v;
    for (const t of l.split(/[\s，,、|]+/)) {          // 整段太长时再按词找
      const w = pick(t.trim());
      if (w) return w;
    }
  }
  return '';
}
// 岗位名里不该带城市（「Java 后端开发工程师 北京」里的北京属于 Base，不是岗位名的一部分）
function smartDropCities(s) {
  return String(s || '')
    .split(/[\s，,。;；、|()（）【】「」\[\]/]+/)
    .filter(t => !(t && t.length <= 6 && matchCity(t)))
    .join(' ')
    .replace(/\s{2,}/g, ' ').trim();
}
function smartGuessPosition(segs, company) {
  for (const seg of segs) {
    let l = seg.trim();
    if (!l || l.length > 40) continue;
    if (company && l.includes(company)) l = l.split(company).join(' ');
    l = smartDropCities(smartStripNoise(l));
    if (l.length < 2 || l.length > 30) continue;
    if (!SMART_POS_WORD.test(l)) continue;
    return l;
  }
  return '';
}
function smartGuessBase(segs, company) {
  for (const seg of segs) {                     // 整段就是一个地点（含多地点写法）
    const l = seg.trim();
    if (!l || l.length > 24) continue;
    if (company && l.includes(company)) continue;
    if (SMART_POS_WORD.test(l)) continue;
    const n = normalizeLocation(l);
    if (n && n !== l) return n;
  }
  const toks = [];                              // 退一步：按词找
  for (const seg of segs) for (const t of seg.split(/[\s，。；、|&()（）【】「」\[\]/]+/)) if (t) toks.push(t);
  for (const t of toks) {
    if (t.length > 6 || (company && t.includes(company))) continue;
    if (SMART_POS_WORD.test(t)) continue;
    if (matchCity(t)) return normalizeLocation(t);
  }
  return '';
}
function smartGuessRemark(segs, company, position) {
  const cands = segs.filter(l => {
    if (l.length < 15) return false;
    if (smartIsMarketing(l)) return false;
    if (company && l.includes(company)) return false;
    if (position && l.includes(position)) return false;
    return true;
  }).sort((a, b) => b.length - a.length);
  return cands.length ? smartStripNoise(cands[0]) : '';
}
// 标题式开头（「科技类专项人才正在报名」）也常常就是岗位名
function smartGuessPositionFromHead(head, company) {
  for (const l of head) {
    let s = smartDropCities(smartStripNoise(smartValue(l)))
      .replace(/(?:正在报名|报名中|招聘中|热招中|急招中|诚聘|热招|急招|招聘|招募)$/, '').trim();
    if (s.length < 2 || s.length > 30) continue;
    if (company && s.includes(company)) continue;
    if (matchCity(s) || !SMART_POS_WORD.test(s)) continue;
    return s;
  }
  return '';
}
// 不属于固定字段、但确实是招聘关键信息的带冒号标签行，收进 extra
function smartCollectExtra(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([^\s:：]{2,8})\s*[:：]\s*(.+)$/);
    if (!m) continue;
    if (SMART_SECTIONS.some(S => S.inline.test(line) || S.title.test(m[1].trim()))) continue;
    if (!SMART_EXTRA_WORDS.test(m[1].trim())) continue;
    const v = smartValue(m[2]).slice(0, 40);
    if (v) out.push({ label: m[1].trim(), value: v });
  }
  return out;
}
// 要点拼成多行文本；只有一条时不加编号，读起来更像人写的
function smartListText(arr) {
  if (!arr.length) return '';
  return arr.length > 1 ? arr.map((s, i) => (i + 1) + '. ' + s).join('\n') : arr[0];
}
// 岗位职责 +（可选）任职要求与附加信息 → 岗位描述正文
function smartComposeRemark(res, withExtra) {
  const parts = [];
  if (res.duty.length) parts.push('岗位职责：\n' + smartListText(res.duty));
  if (!withExtra) return parts.join('\n\n');
  if (res.requirement.length) parts.push('任职要求：\n' + smartListText(res.requirement));
  const kv = [];
  if (res.salary) kv.push('薪资：' + res.salary);
  if (res.headcount) kv.push('招聘人数：' + res.headcount);
  if (res.contact) kv.push('联系方式：' + res.contact);
  if (res.deadline) kv.push('投递截止：' + res.deadline);
  for (const e of (res.extra || [])) kv.push(e.label + '：' + e.value);
  if (kv.length) parts.push(kv.join('\n'));
  return parts.join('\n\n');
}
function parseJobText(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const out = {
    company: '', position: '', base: '',
    duty: [], requirement: [],
    salary: '', headcount: '', contact: '', deadline: '',
    link: '', extra: [], remark: '',
  };
  const mLink = text.match(/https?:\/\/[^\s，。；）)"']+/);
  if (mLink) out.link = mLink[0].replace(/[。，,；;]+$/, '');
  const body = mLink ? text.replace(mLink[0], ' ') : text;
  const lines = body.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const segs = smartSegments(body);
  const { sec, head } = smartSplitSections(lines);

  // 第 1 层：段标题 / 标签行 —— 命中率最高，几乎不会错
  if (sec.company)     out.company     = smartFirstBranch(smartValue(smartCleanLines(sec.company).join(' ')));
  if (sec.position)    out.position    = smartStripNoise(smartValue(smartCleanLines(sec.position).join(' ')));
  if (sec.base) {
    // 段里混进下一个标签时（「杭州 招聘公司：…」），只取冒号之前的部分
    let bv = smartValue(smartCleanLines(sec.base).join(' '));
    const bi = bv.search(/[:：]/);
    if (bi >= 0) bv = bv.slice(0, bi).trim();
    out.base = normalizeLocation(bv);
  }
  if (sec.duty)        out.duty        = smartBullets(smartCleanLines(sec.duty).join('\n'));
  if (sec.requirement) out.requirement = smartBullets(smartCleanLines(sec.requirement).join('\n'));
  if (sec.salary)      out.salary      = smartPickSalary(smartCleanLines(sec.salary).join(' '));
  if (sec.headcount)   out.headcount   = smartPickHeadcount(smartCleanLines(sec.headcount).join(' '));
  if (sec.contact)     out.contact     = smartPickContact(smartCleanLines(sec.contact).join(' '));
  if (sec.deadline)    out.deadline    = smartPickDate(smartCleanLines(sec.deadline).join(' '));
  out.extra = smartCollectExtra(lines);

  // 机构分支（「江西省分行」）补上公司主体：「中国建设银行」+「江西省分行」
  if (out.company && /(?:分行|支行|营业部|分公司|子公司|总行|事业部|事业群)$/.test(out.company)) {
    const main = smartGuessCompany(segs, body);
    if (main && main !== out.company && !out.company.includes(main)) out.company = main + out.company;
  }

  // 第 2 层：历史填过的单位 / 岗位（datalist 候选），命中就是 100% 准
  if (!out.company)  out.company  = smartKnown('#company-list', body, 2);
  if (!out.position) out.position = smartKnown('#position-list', body, 3);
  // 第 3 层：启发式 —— 公司后缀、首个短段、岗位关键词、地名表
  if (!out.company)  out.company  = smartGuessCompany(segs, body)
    || smartGuessCompanyFirst(segs) || smartGuessCompanyBracket(body);
  if (!out.base)     out.base     = smartGuessBase(segs, out.company);
  if (!out.position) out.position = smartGuessPositionFromHead(head, out.company);
  if (!out.position) out.position = smartGuessPosition(segs, out.company);
  // 职责 / 要求都没分出段落时，退化成「挑最长的一段当描述」，仍留空优先于乱猜
  if (!out.duty.length && !out.requirement.length) {
    const r = smartGuessRemark(segs, out.company, out.position);
    if (r) out.duty = smartBullets(r);
  }
  // 正文里明确写了薪资 / 人数 / 联系方式但没标签行时，也一并提出来
  if (!out.salary)    out.salary    = smartPickSalary(body);
  if (!out.headcount) out.headcount = smartPickHeadcount(body);
  if (!out.contact)   out.contact   = smartPickContact(body);

  out.remark = smartComposeRemark(out, true);
  return out;
}
// 面板开关：与「批量粘贴」互斥，同时只展开一个
function setSmartMode(on) {
  const btn = $('#f-pos-smart'), box = $('#smart-box'), ta = $('#f-smart-text');
  if (!btn || !box || !ta) return;
  const bb = $('#batch-box');
  if (on && bb && !bb.classList.contains('hidden')) setBatchMode(false, { merge: true });
  if (!on) { ta.value = ''; renderSmartPreview(null); }
  btn.dataset.on = on ? '1' : '0';
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  box.classList.toggle('hidden', !on);
}
function smartRow(label, key, val, multi) {
  const v = val ? esc(val) : '';
  const ctl = multi ? `<textarea id="sp-${key}" rows="4">${v}</textarea>` : `<input id="sp-${key}" value="${v}">`;
  return `<div class="sp-row"><span class="sp-lab">${label}</span>${ctl}</div>`;
}
// 结构化提取里不进表单的那几项（任职要求 / 薪资 / 人数 / 联系方式 / 截止）单独列出来给人核对
function smartExtraHtml(res) {
  const kv = (k, v) => `<div class="sp-kv"><span>${k}</span><b>${esc(v)}</b></div>`;
  const rows = [];
  if (res.requirement.length) {
    rows.push('<div class="sp-kv col"><span>任职要求</span><ol class="sp-ol">'
      + res.requirement.map(s => `<li>${esc(s)}</li>`).join('') + '</ol></div>');
  }
  if (res.salary) rows.push(kv('薪资', res.salary));
  if (res.headcount) rows.push(kv('招聘人数', res.headcount));
  if (res.contact) rows.push(kv('联系方式', res.contact));
  if (res.deadline) rows.push(kv('投递截止', res.deadline));
  for (const e of (res.extra || [])) rows.push(kv(e.label, e.value));
  if (!rows.length) return '';
  return '<div class="sp-extra"><div class="sp-extra-t">其他识别到的信息</div>' + rows.join('') + '</div>';
}
const smartState = { res: null, merge: true, dirty: false };
// 勾选项变化时重算岗位描述；用户一旦手改过就不再自动覆盖
function refreshSmartRemark() {
  const ta = $('#sp-remark');
  if (!ta || !smartState.res || smartState.dirty) return;
  ta.value = smartComposeRemark(smartState.res, smartState.merge);
}
function renderSmartPreview(res) {
  const box = $('#smart-preview');
  if (!box) return;
  if (!res) { box.classList.add('hidden'); box.innerHTML = ''; smartState.res = null; return; }
  smartState.res = res; smartState.merge = true; smartState.dirty = false;
  box.classList.remove('hidden');
  box.innerHTML = '<div class="smart-prev">'
    + smartRow('单位名称', 'company', res.company)
    + smartRow('岗位', 'position', res.position)
    + smartRow('Base 地', 'base', res.base)
    + smartRow('投递链接', 'link', res.link)
    + smartRow('岗位描述', 'remark', res.remark, true)
    + '</div>'
    + smartExtraHtml(res)
    + '<label class="sp-check"><input type="checkbox" id="sp-merge" checked>'
    + '任职要求与附加信息一并写入岗位描述</label>'
    + '<div class="batch-foot">认不出的字段一律留空，不会乱猜；上面可直接改，确认后才填入表单</div>'
    + '<div class="smart-actions"><button type="button" id="sp-apply" class="btn-mini">填入表单</button>'
    + '<button type="button" id="sp-cancel" class="btn-mini ghost">取消</button></div>';
  const cb = $('#sp-merge');
  if (cb) cb.addEventListener('change', () => { smartState.merge = cb.checked; refreshSmartRemark(); });
  const ta = $('#sp-remark');
  if (ta) ta.addEventListener('input', () => { smartState.dirty = true; });
  const ap = $('#sp-apply'); if (ap) ap.addEventListener('click', applySmart);
  const cc = $('#sp-cancel'); if (cc) cc.addEventListener('click', () => setSmartMode(false));
}
function runSmart() {
  const ta = $('#f-smart-text');
  const text = ta ? ta.value : '';
  if (!text.trim()) { toast('先粘贴一段招聘信息'); return; }
  const r = parseJobText(text);
  const empty = !r.company && !r.position && !r.base && !r.link
    && !r.duty.length && !r.requirement.length
    && !r.salary && !r.headcount && !r.contact && !r.deadline;
  if (empty) toast('没认出可用字段，下面的框可以直接补');
  renderSmartPreview(r);
}
// 只填空字段，已有内容一律不覆盖（避免把用户手填的内容冲掉）
function applySmart() {
  const val = k => { const el = $('#sp-' + k); return el ? String(el.value || '').trim() : ''; };
  const u = draftUnits[0];
  if (!u) return;
  let filled = 0;
  const skipped = [];
  const co = val('company'), coEl = $('#f-company');
  if (co && coEl) {
    if (!coEl.value.trim()) { coEl.value = co; filled++; }
    else if (coEl.value.trim() !== co) skipped.push('单位名称');
  }
  const lk = val('link'), lkEl = $('#f-link');
  if (lk && lkEl && !lkEl.value.trim()) { lkEl.value = lk; filled++; }
  const name = val('position'), base = val('base'), remark = val('remark');
  if (name || base || remark) {
    let p = u.positions.find(x => !(x.name || '').trim() && !(x.base || '').trim() && !(x.remark || '').trim());
    if (!p && u.positions.length >= MAX_POSITIONS) toast(`最多 ${MAX_POSITIONS} 个岗位`);
    if (!p) { p = newPosition(''); u.positions.push(p); }
    if (p) {
      if (name && !p.name) p.name = name;
      if (base && !p.base) p.base = normalizeLocation(base);
      if (remark && !p.remark) p.remark = remark;
      filled++;
    }
  }
  rerenderPositions(u);
  updateUnitCount();
  setSmartMode(false);
  if (filled) toast(`已填入 ${filled} 项${skipped.length ? '；' + skipped.join('、') + '已有内容，未覆盖' : ''}`);
  else toast('没有可填入的内容');
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
  // 每个岗位一条记录：Base 地 / 备注 / 阶段取自该岗位自己的数据，岗位全空也生成 1 条（只投单位不明岗位）
  const list = [];
  const seen = new Set();
  for (const p of u.positions) {
    const name = (p.name || '').trim();
    if (name) {
      const k = posKeyOf(name) + '|' + posKeyOf(p.base) + '|' + posKeyOf(p.remark);   // 去重键 = 岗位名 + Base + 备注：三者全同才算重复岗位
      if (seen.has(k)) continue;          // 岗位名 / Base / 备注任一不同都各自保留；同名同 Base 同备注的真重复只留一条；批量粘贴的空 Base/空备注行也会在这里合并
      seen.add(k);
    }
    list.push({
      name: name || null,
      base: normalizeLocation(p.base || '') || null,
      remark: (p.remark || '').trim() || null,
      imgs: p.imgs || [],
      ...stagePayloadOf(p),
    });
  }
  if (!list.length) list.push({ name: null, base: null, remark: null, imgs: [], ...stagePayloadOf({ stage: draftStage, stageDates: draftDates }) });
  if (list.length > MAX_RECORDS) { toast(`一次最多提交 ${MAX_RECORDS} 条投递，请分批添加`); return; }
  let error = null, n = 0;
  if (editingId) {
    const first = list[0];
    const r = await sb.from('applications').update({ ...base, position: first.name, base: first.base, remark: first.remark, remark_images: first.imgs, stage: first.stage, stage_dates: first.stage_dates, stage_dates_at: first.stage_dates_at, apply_date: first.apply_date }).eq('id', editingId);
    error = r.error; n = 1;
    const rest = list.slice(1);
    if (!error && rest.length) {
      const r2 = await sb.from('applications').insert(rest.map(x => ({ ...base, position: x.name, base: x.base, remark: x.remark, remark_images: x.imgs, stage: x.stage, stage_dates: x.stage_dates, stage_dates_at: x.stage_dates_at, apply_date: x.apply_date })));
      error = r2.error; n += rest.length;
    }
  } else {
    const r = await sb.from('applications').insert(list.map(x => ({ ...base, position: x.name, base: x.base, remark: x.remark, remark_images: x.imgs, stage: x.stage, stage_dates: x.stage_dates, stage_dates_at: x.stage_dates_at, apply_date: x.apply_date })));
    error = r.error; n = list.length;
  }
  if (error) { toast('保存失败：' + error.message, 'error'); return; }
  if (editingId) await removeStaleImages(beforeImgs, list[0] && list[0].imgs);
  const gName = base.group_name;
  toast(gName
    ? (n > 1 ? `已添加 ${n} 条投递，归入「${gName}」` : `已保存，归入「${gName}」`)
    : (n > 1 ? `已添加 ${n} 条投递` : '已保存'));
  stopDraftPolling();   // 保存成功：草稿使命完成，停轮询并清除，别让残留表单又被写回草稿
  clearDraft();
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
      // 阶段按岗位：岗位自己的日期 + 单位卡的投递日（单位卡日期覆盖岗位日期里的投递，口径与界面一致）
      const stage_dates = { ...(p.stageDates || {}) };
      if (u.date) stage_dates['投递'] = u.date; else delete stage_dates['投递'];
      const stage = stageFromDates(stage_dates) || p.stage || (isEdit ? groupEditStage : '投递');
      // 时间同样只保留有日期的项（单位卡的投递日会覆盖岗位里的投递，时间口径跟日期保持一致）
      const stage_dates_at = stageTimesOf({ stageDates: stage_dates, stageTimes: p.stageTimes });
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
        stage_dates_at,
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
      stage_dates_at: stageTimesOf({ stageDates: stage_dates, stageTimes: groupEditStageTimes }),
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
  stopDraftPolling();   // 保存成功：停轮询并清除草稿
  clearDraft();
  editingId = null;
  draftGroup = '';
  await loadRecords();
  showView('feed');
}
// 删除后给一次后悔机会：删之前把行内容留一份快照，撤销时原样写回。
// 不复用原 id（id 是 identity 列，显式写入会报错），但 update_time 一并带回去，排序位置不变。
const WRITE_FIELDS = ['company','group_name','base','sub_unit','position','link','remark','remark_images',
  'stage','stage_dates','stage_dates_at','apply_date','update_time'];
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
  // 输入框被清空 → 记空串，表示「这一项要清掉」；认不出的写法跳过，不动库里已有值。
  const next = {};
  document.querySelectorAll('#sheet-body [data-sds]').forEach((el) => {
    const raw = String(el.value || '').trim();
    if (!raw) { next[el.dataset.sds] = ''; return; }
    const v = parseDate(raw);
    if (v) next[el.dataset.sds] = v;
  });
  const cur = rec.stage_dates || {};
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)]);
  let changed = false;
  for (const k of keys) { if ((cur[k] || '') !== (next[k] || '')) { changed = true; break; } }
  // 时间：读下拉当前值；日期被清空的那一项时间一并清掉，日期还在的按选择写入
  const nextTimes = {};
  const curTimes = timesOf(rec);
  document.querySelectorAll('#sheet-body [data-sdt]').forEach((el) => {
    const stage = el.dataset.sdt;
    const v = cleanTime(el.value);
    if (v && next[stage]) nextTimes[stage] = v;
  });
  for (const stage of new Set([...Object.keys(curTimes), ...Object.keys(nextTimes)])) {
    if ((curTimes[stage] || '') !== (nextTimes[stage] || '')) { changed = true; break; }
  }
  if (!changed) return;
  const derived = stageFromDates(next);
  patchSheetDates(sheetId, next, derived ? ('已记录 · 当前阶段：' + derived) : '已保存日期', nextTimes);
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
  // 多地点写法取第一段，否则整段参与匹配永远命中不了
  const s = String(base || '').split(/[、,，\/|]/)[0].trim();
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
        <div class="sheet-field-label">岗位描述</div>
        <div class="sheet-remark-text">${esc(rec.remark)}</div>
      </div>`;
  }
  // 岗位图片：点开看大图（viewer 由 app.js 统一挂在 body 上）
  const imgs = imgsOf(rec);
  if (imgs.length) {
    remarkHTML += `
      <div class="sheet-field">
        <div class="sheet-field-label">岗位附件（${imgs.length}）</div>
        <div class="sheet-imgs">${imgs.map((im, k) => `<img class="sheet-img"
           data-path="${esc(im.path)}" alt="附件 ${k + 1}" loading="lazy">`).join('')}</div>
      </div>`;
  }

  const dates = ALL_STAGES.map(s => {
    const v = rec.stage_dates && rec.stage_dates[s];
    const t = timesOf(rec)[s];
    return `<div class="sheet-date-row">
      <div class="sd-name"><span class="sd-dot" style="background:${COLORS[s]}"></span>${s}</div>
      <input class="sheet-date-input" data-sds="${s}" placeholder="未记录 · 可填 今天 / 9月28日" value="${v ? esc(v) : ''}">
      ${v ? timeSelectHTML(`data-sdt="${s}"`, t)
        : '<button type="button" class="time-locked" data-sdt-need="' + s + '" title="先填日期，再填具体时间">时间</button>'}
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
  hydrateImages($('#sheet-body'));   // 附件走签名 URL：渲染完统一回填 src
}
// 详情弹层可以从首页或搜索页打开，两个列表里都有这条记录的阶段卡片。
// 写完之后只重画首页，会让「在搜索页改完再返回搜索页」看到改动前的阶段。
function refreshListsAfterEdit() {
  renderFeed();
  renderSearch();
}
// times：可选的「阶段 → 具体时间」整份快照。传了就整体替换该记录的时间表，
// 不传则只按 dates 的增删同步（日期被清掉的项，时间也跟着清）。
async function patchSheetDates(id, dates, msg, times) {
  const ref = records.find(r => r.id === id); if (!ref) return;
  const next = { ...(ref.stage_dates || {}), ...dates };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  const derived = stageFromDates(next);
  let nextTimes;
  if (times) {
    nextTimes = {};
    for (const [s, t] of Object.entries(times)) {
      const v = cleanTime(t);
      if (v && next[s]) nextTimes[s] = v;      // 只保留有日期的项
    }
  } else {
    nextTimes = timesOf(ref);
    for (const s of Object.keys(nextTimes)) if (!next[s]) delete nextTimes[s];
  }
  const patch = {
    stage_dates: next,
    stage_dates_at: nextTimes,
    apply_date: next['投递'] || null,
    update_time: new Date().toISOString(),
    stage: derived || '投递',
  };
  const { error } = await sb.from('applications').update(patch).eq('id', id);
  if (error) { toast('更新失败：' + error.message, 'error'); return; }
  if (msg) toast(msg, 'success');
  await loadRecords();
  refreshListsAfterEdit();
  renderSheet(id);
}

async function patchSheetDate(id, stage, value, opts) {
  // 传空值 = 明确清掉这一项：合并时把它置空，patchSheetDates 里会把空值删掉。
  // （不能写成「传空值就什么都不传」——那样库里原值还在，界面重新渲染后日期又冒出来）
  const dates = { [stage]: value || '' };
  await patchSheetDates(id, dates, (opts && opts.silent) ? '' : (value ? ('已记录 · 当前阶段：' + (stageFromDates({ ...(records.find(r => r.id === id) || {}).stage_dates, ...dates }) || '投递')) : '已清除该日期'));
}
// 弹层里改具体时间：只更新这一个阶段，其余阶段保留原值
async function patchSheetTime(id, stage, value) {
  const rec = records.find(r => r.id === id); if (!rec) return;
  if (!((rec.stage_dates || {})[stage])) { toast('先填这一阶段的日期，再填具体时间'); return; }
  const v = cleanTime(value);
  const times = { ...timesOf(rec) };
  if (v) times[stage] = v; else delete times[stage];
  await patchSheetDates(id, {}, v ? ('已记录 · ' + stage + ' ' + v) : '已清除该时间', times);
}

// ---------- 账户 ----------
function renderAccount() {
  $('#account-email').textContent = user.email || '';
  $('#account-avatar').textContent = (user.email || '我')[0].toUpperCase();
}
function exportCSV() {
  const headers = ['集团', '单位', '二级单位', 'Base', '岗位', '阶段', '投递日期', '链接', '岗位描述'];
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
// 登录/注册报错翻成人话；认识不了的原文透出
function authErrorZh(msg) {
  const m = String(msg || '');
  const table = [
    ['Anonymous sign-ins are disabled', '请先填写邮箱和密码，再点「登录」或「注册新账号」'],
    ['Invalid login credentials', '邮箱或密码不对'],
    ['Email not confirmed', '邮箱还没确认：请先查收确认邮件，点邮件里的链接激活后再登录'],
    ['User already registered', '该邮箱已注册过，直接点「登录」即可'],
    ['Signups not allowed', '当前已关闭新用户注册'],
    ['Password should be at least', '密码至少 6 位'],
    ['Unable to validate email address', '邮箱格式不对，检查一下有没有写错'],
    ['Email address', '邮箱格式不对，检查一下有没有写错'],
    ['Failed to fetch', '网络异常，请稍后再试'],
  ];
  for (const [k, v] of table) if (m.includes(k)) return v;
  return m;
}
const AUTH_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 登录/注册前的本地校验：不合法直接提示并聚焦，不发请求。
// 否则空邮箱+空密码会被 Supabase 当成匿名注册，报出看不懂的 "Anonymous sign-ins are disabled"
// ids：{ email, pass } 分别指向登录卡或注册弹窗里的输入框
function authValidate(mode, ids) {
  const email = $(ids.email).value.trim();
  const pass = $(ids.pass).value;
  if (!email)               return { err: '请先填写邮箱', focus: ids.email };
  if (!AUTH_EMAIL_RE.test(email)) return { err: '邮箱格式不对，检查一下有没有写错', focus: ids.email };
  if (!pass)                return { err: '请先填写密码', focus: ids.pass };
  if (mode === 'signup' && pass.length < 6) return { err: '注册密码至少 6 位', focus: ids.pass };
  return { email, pass };
}
function openSignupModal() {
  const m = $('#signup-modal');
  m.classList.remove('hidden');
  $('#signup-error').textContent = '';
  $('#signup-error').classList.remove('ok');
  setTimeout(() => $('#signup-email').focus(), 30);
}
function closeSignupModal() {
  $('#signup-modal').classList.add('hidden');
}
function bindEvents() {
  // 登录：读登录卡的输入框
  $('#btn-signin').addEventListener('click', async () => {
    const errEl = $('#auth-error'); errEl.textContent = ''; errEl.classList.remove('ok');
    const v = authValidate('signin', { email: '#auth-email', pass: '#auth-pass' });
    if (v.err) { errEl.textContent = v.err; $(v.focus).focus(); return; }
    const { error } = await sb.auth.signInWithPassword({ email: v.email, password: v.pass });
    if (error) { errEl.textContent = authErrorZh(error.message); return; }
    const { data } = await sb.auth.getSession();
    user = data.session.user;
    await enterApp();
  });
  // 打开 / 关闭注册弹窗
  $('#btn-open-signup').addEventListener('click', openSignupModal);
  $$('#signup-modal [data-close-signup]').forEach(el => el.addEventListener('click', closeSignupModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#signup-modal').classList.contains('hidden')) closeSignupModal();
  });
  // 注册：读弹窗输入框，先校验两次密码一致
  $('#btn-signup').addEventListener('click', async () => {
    const errEl = $('#signup-error'); errEl.textContent = ''; errEl.classList.remove('ok');
    const v = authValidate('signup', { email: '#signup-email', pass: '#signup-pass' });
    if (v.err) { errEl.textContent = v.err; $(v.focus).focus(); return; }
    if ($('#signup-pass2').value !== v.pass) {
      errEl.textContent = '两次输入的密码不一致'; $('#signup-pass2').focus(); return;
    }
    const { data, error } = await sb.auth.signUp({ email: v.email, password: v.pass });
    if (error) { errEl.textContent = authErrorZh(error.message); return; }
    if (data.session) { closeSignupModal(); user = data.session.user; await enterApp(); }
    else { errEl.classList.add('ok'); errEl.textContent = '注册成功！请先查收确认邮件，点邮件里的链接激活账号后再登录'; }
  });

  // 底部标签栏
  $$('.tab').forEach(b => b.addEventListener('click', () => showView(b.dataset.nav)));
  // 悬浮添加：有未保存草稿则直接恢复，否则新开空表单（草稿提示条也提供「丢弃」入口）
  $('#fab').addEventListener('click', () => {
    const d = readDraft();
    if (d && !draftIsEmpty(d)) restoreDraft(d);
    else openEditView();
  });

  // 草稿提示条：继续填写 / 丢弃；编辑页里的「放弃草稿」按钮清空后回到全新空表单
  $('#draft-resume').addEventListener('click', () => {
    const d = readDraft();
    if (d && !draftIsEmpty(d)) restoreDraft(d);
    else renderDraftBanner();
  });
  $('#draft-discard').addEventListener('click', () => { clearDraft(); renderDraftBanner(); });
  $('#btn-discard-draft').addEventListener('click', () => { clearDraft(); openEditView(); });

  // 日程：点条目直接进那条记录的详情；点「收起 / 展开」折叠整个日程块
  $('#schedule').addEventListener('click', (e) => {
    const row = e.target.closest('[data-sch]');
    if (row) { openSheet(Number(row.dataset.sch)); return; }
    if (e.target.closest('#sch-toggle')) {
      schCollapsed = !schCollapsed;
      renderSchedule();
    }
  });

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

  // 搜索：一个主搜索框 + 阶段快捷分类 + 排序方式
  const onSearchChange = () => { searchShown = PAGE_SIZE; renderSearch(); };
  const kwInput = $('#search-kw');
  // 边打边搜，但中文输入法拼字过程（isComposing）不触发，避免拼音阶段结果闪跳；
  // 同时做 160ms 防抖，一次连续输入只渲染一次
  let kwTimer = 0, composing = false;
  const applyKw = () => { searchState.kw = kwInput.value; onSearchChange(); };
  kwInput.addEventListener('compositionstart', () => { composing = true; });
  kwInput.addEventListener('compositionend', () => {
    composing = false; clearTimeout(kwTimer); applyKw();
  });
  kwInput.addEventListener('input', (e) => {
    if (composing || e.isComposing) return;
    clearTimeout(kwTimer);
    kwTimer = setTimeout(applyKw, 160);
  });
  // 回车 / 点「搜索」：立即检索并收起移动端键盘
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault(); clearTimeout(kwTimer); applyKw(); kwInput.blur();
  });
  $('#search-kw-clear').addEventListener('click', () => {
    kwInput.value = ''; searchState.kw = ''; onSearchChange(); kwInput.focus();
  });
  $('#search-sort').addEventListener('change', (e) => { searchState.sort = e.target.value; onSearchChange(); });
  $('#search-stages').addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage]'); if (!t) return;
    searchState.stage = t.dataset.stage; onSearchChange();
  });
  $('#search-clear').addEventListener('click', () => {
    searchState = { ...searchState, kw: '', stage: '全部' };
    kwInput.value = '';
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
    const needT = e.target.closest('[data-sdt-need]');
    if (needT) { toast('先填这一阶段的日期，再填具体时间'); return; }
    const dt = e.target.closest('[data-sdtoday]');
    if (dt) { patchSheetDate(sheetId, dt.dataset.sdtoday, todayStr()); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { const id = Number(ed.dataset.edit); closeSheet(); openEditView({ id }); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) { deleteRecord(Number(dl.dataset.del)); }
  });
  // 弹层日期直接编辑：解析自然语言/原生日期值，清空即删除该日期；时间是选好的 HH:MM
  $('#sheet').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-sdt]');
    if (sel) { patchSheetTime(sheetId, sel.dataset.sdt, sel.value); return; }
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
    // 没选中任何岗位时拦一下：写了也没去处，提示比静默无效更不容易让人误以为已保存
    if (!stageScopeTargets().length) { toast('请先点岗位左侧的圆圈选中岗位'); return; }
    draftStage = t.dataset.stage;
    // 选中某阶段时，若该阶段尚无日期则自动记为今天（与详情页一致，少一次手动填日期）；
    // 同时清掉流程上更靠后的阶段日期，保证「点谁切到谁」（如点过 Offer 后点三面要能切回去）
    const hadDate = !!draftDates[draftStage];
    if (!hadDate) draftDates[draftStage] = todayStr();
    if (pruneLaterStageDates(draftStage) || !hadDate) renderDateRows();
    applyBufferToTargets();   // 写到选中的岗位（没选=全部），并刷新岗位行上的阶段徽章
    renderEditStagesOnly();
  });
  // 范围指示可点击：恢复「应用到全部岗位」
  $('#scope-indicator').addEventListener('click', () => {
    if (!stageScope) return;
    stageScope = null;
    toast('已恢复应用到全部岗位');
    syncBufferFromScope();
    refreshScopeCircles();
    updateScopeIndicator();
  });
  $('#edit-dates').addEventListener('change', (e) => {
    const dp = e.target.closest('[data-dp]');
    if (dp) {
      draftDates[dp.dataset.dp] = dp.value || '';
      if (!dp.value) delete draftTimes[dp.dataset.dp];   // 日期清掉，挂在它上面的时间一并清掉
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      applyBufferToTargets();
      renderDateRows();
      renderEditStagesOnly();
      return;
    }
    const ts = e.target.closest('[data-dt]');
    if (ts) {
      const stage = ts.dataset.dt;
      const v = cleanTime(ts.value);
      if (v) draftTimes[stage] = v; else delete draftTimes[stage];
      applyBufferToTargets();
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
    // 没填日期的行上，时间控件是置灰的提示按钮：点它先提示补日期，而不是静默无反应
    const need = e.target.closest('[data-dt-need]');
    if (need) { toast('先填这一阶段的日期，再填具体时间'); return; }
    const td = e.target.closest('[data-today]');
    if (td) {
      draftDates[td.dataset.today] = todayStr();
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      applyBufferToTargets();
      renderDateRows();       // 重新渲染：刚才没日期的行要露出时间控件
      renderEditStagesOnly();
      return;
    }
    const yt = e.target.closest('[data-yesterday]');
    if (yt) {
      draftDates[yt.dataset.yesterday] = shiftDays(-1);
      const derived = stageFromDates(draftDates);
      if (derived) draftStage = derived;
      applyBufferToTargets();
      renderDateRows();
      renderEditStagesOnly();
      return;
    }
    const cl = e.target.closest('[data-clear]');
    if (cl) {
      dateSkip.add('dp:' + cl.dataset.clear);
      delete draftDates[cl.dataset.clear];
      delete draftTimes[cl.dataset.clear];   // 日期和它上面的时间一起清
      const derived = stageFromDates(draftDates);
      draftStage = derived || '投递';
      applyBufferToTargets();
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
    if (setPositionMeta(u, t)) { autoGrowRemark(t); return; }   // 岗位行内的 Base 地 / 岗位描述
    if (t.dataset.pk) editPositionName(u, t.dataset.pk, t.value);
  });
  $('#g-rows').addEventListener('click', (e) => {
    const sel = e.target.closest('[data-psel]');
    if (sel) { toggleScopePosition(sel.dataset.psel); return; }   // 岗位选中圈：切换该岗位是否在阶段应用范围里
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
    if (setPositionMeta(draftUnits[0], t)) { autoGrowRemark(t); return; }   // 岗位行内的 Base 地 / 岗位描述
    editPositionName(draftUnits[0], t.dataset.pk, t.value);
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
    const sel = e.target.closest('[data-psel]');
    if (sel) { toggleScopePosition(sel.dataset.psel); return; }   // 岗位选中圈：切换该岗位是否在阶段应用范围里
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
  // 智能识别：粘贴招聘文本 → 解析出字段 → 可编辑预览 → 确认后填入
  $('#f-pos-smart').addEventListener('mousedown', (e) => e.preventDefault());
  $('#f-pos-smart').addEventListener('click', () => {
    const btn = $('#f-pos-smart');
    const open = btn.dataset.on !== '1';
    setSmartMode(open);
    if (open) $('#f-smart-text').focus();
  });
  $('#smart-run').addEventListener('click', runSmart);
  $('#smart-cancel').addEventListener('click', () => setSmartMode(false));
  $('#f-smart-text').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setSmartMode(false); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSmart(); }
  });
  $('#btn-delete').addEventListener('click', () => deleteRecord());

  // 账户
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-fix-base').addEventListener('click', normalizeAllBases);
  $('#btn-signout').addEventListener('click', () => { purgeSignedCache(); sb.auth.signOut(); });

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
    `<span class="chip ${draftStage === s ? 'on' : ''}" data-stage="${s}" style="${draftStage === s ? 'background:' + COLORS[s] + ';color:#fff' : ''}" role="button" tabindex="0">${s}</span>`).join('');
}

// ---------- 启动 ----------
// 关闭 / 刷新页面时兜底落盘：轮询有 1 秒间隔，最后几秒的输入可能还在内存里没写进 localStorage
window.addEventListener('beforeunload', () => {
  if (draftPollTimer) persistDraft();
});
bindEvents();
initAuth();
