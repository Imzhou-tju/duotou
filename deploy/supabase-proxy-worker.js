/**
 * Supabase 反代（Cloudflare Worker）
 * =====================================================================
 * 解决什么问题：手机移动网络直连 xxx.supabase.co 经常不通（DNS 污染 / 拦截），
 * 表现是登录报「连不上云服务器」，且因为从没登录成功过、每次打开都要求重新输账号密码。
 * 桌面能通只是因为走了代理。这个 Worker 把请求中转到 Supabase，手机连 Worker 即可。
 *
 * 部署（约 5 分钟，免费额度足够个人使用）：
 *   1. 登录 https://dash.cloudflare.com → 左侧「Workers & Pages」→「Create」→
 *      「Start with Hello World」或直接 Create Worker，名字随便取（如 duotou-api）。
 *   2. 点「Edit code」，把本文件全文粘贴进去，保存并 Deploy。
 *   3. 环境变量：Worker → Settings → Variables → 添加
 *        SUPABASE_ORIGIN = https://evdkesfvgfhkuaitanhr.supabase.co
 *      （就是你 config.js 里现在那个地址，末尾不要带斜杠）
 *   4. 记下 Worker 地址：https://<你的worker名>.<你的子域>.workers.dev
 *      —— 更稳的做法是给它绑一个自己的域名（Triggers → Custom Domain），
 *      workers.dev 在国内部分网络也会抽风。
 *   5. 改 config.js：SUPABASE_URL 填成上面的 Worker 地址，其余不变
 *      （anon key 不用动，它是公开的；数据安全仍由数据库 RLS 保证）。
 *
 * 自测：浏览器打开 <Worker地址>/rest/v1/ ，返回 401（缺少 apikey）就说明通了。
 *
 * 说明：
 *   - 只做转发，不改请求体、不碰 Authorization / apikey，用户身份仍由 Supabase 校验；
 *   - CORS 放开到 GitHub Pages 域名（下面 ALLOWED_ORIGIN），换部署地址时同步改；
 *   - 免费额度 10 万次/天，个人投递记录远够用。
 */

const SUPABASE_ORIGIN = (typeof SUPABASE_ORIGIN !== 'undefined' ? SUPABASE_ORIGIN : '')
  || 'https://evdkesfvgfhkuaitanhr.supabase.co';

// 允许跨域的来源：你的线上页面地址（末尾不带斜杠）
const ALLOWED_ORIGIN = 'https://imzhou-tju.github.io';

// 预检响应头：supabase-js 会带这些自定义头，必须全部放行
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers':
    'apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, range',
  'Access-Control-Expose-Headers': 'content-range, content-length, x-total-count',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // 预检：直接回 204，浏览器才会放行真正的请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, SUPABASE_ORIGIN);

    // 转发用的请求头：保留 supabase-js 需要的，去掉 Cloudflare 自己加的
    const headers = new Headers(request.headers);
    headers.set('Host', new URL(SUPABASE_ORIGIN).host);
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    // 压缩交给上游，避免重复编码出问题
    headers.delete('cf-worker');

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    let resp;
    try {
      resp = await fetch(target.toString(), {
        method: request.method,
        headers,
        body,
        redirect: 'manual',   // 重定向也自己转，别让浏览器跨域跳来跳去
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'proxy_upstream_failed', detail: String(e) }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      });
    }

    const respHeaders = new Headers(resp.headers);
    // 上游的 CORS 头是给 supabase.co 的，这里换成页面域名
    for (const k of [...respHeaders.keys()]) {
      if (k.toLowerCase().startsWith('access-control-')) respHeaders.delete(k);
    }
    Object.assign(respHeaders, CORS_HEADERS);

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
    });
  },
};
