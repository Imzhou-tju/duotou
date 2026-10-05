-- 多投 · 备注图片功能的一次性初始化
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴执行即可，幂等，可反复执行。
-- 执行完刷新网页，岗位备注旁的「＋ 图」就能用了。
--
-- 做了什么：
--   1) 建公开存储桶 remark-media（图片要能直接在网页里显示，所以桶是 public）；
--      但「谁能上传、谁能删除」由下面两条策略按路径前缀限制，只有你自己的目录能写。
--   2) applications 表加 remark_images 列（JSONB 数组），存图片的路径与访问地址。

-- 1) 存储桶
insert into storage.buckets (id, name, public)
values ('remark-media', 'remark-media', true)
on conflict (id) do nothing;

-- 2) 权限：图片路径统一放在 {你的用户id}/ 目录下，策略据此判断归属。
--    注意：桶是 public，所以「拿到链接的人都能看到图」；这里管的是「谁能写、谁能删」。
drop policy if exists "remark-media own insert" on storage.objects;
drop policy if exists "remark-media own delete" on storage.objects;

create policy "remark-media own insert" on storage.objects
  for insert with check (
    bucket_id = 'remark-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "remark-media own delete" on storage.objects
  for delete using (
    bucket_id = 'remark-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) 表里加列
alter table public.applications
  add column if not exists remark_images jsonb not null default '[]'::jsonb;
