// ===== Supabase 配置 =====
// 1) 打开 https://supabase.com/dashboard → New project 创建项目
// 2) Project Settings → API 页面，复制两个值填到下面：
//    - Project URL        → 填入 SUPABASE_URL
//    - anon public key    → 填入 SUPABASE_ANON_KEY
//    （anon key 是公开设计的，数据安全靠数据库里的 RLS 策略保证，见 schema.sql）
// 3) SQL Editor 里执行 schema.sql 建表
// 注意：SUPABASE_URL 只填项目根地址，不要带 /rest/v1/ 等后缀（SDK 会自动拼接）。
// SUPABASE_ANON_KEY 必须是完整 key（100+ 字符的 JWT 或 sb_publishable_ 开头），
//   在 Supabase 后台「API Keys」页面点复制按钮获取，不要手动选中打码文本。
const SUPABASE_URL = 'https://evdkesfvgfhkuaitanhr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2ZGtlc2Z2Z2Zoa3VhaXRhbmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NjAwNzgsImV4cCI6MjEwNjMzNjA3OH0.iIpUep2lqVoifUfwk3GexTSrsGl-lueAwnf_nf49xO8';
