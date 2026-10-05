-- 多投 · 秋招投递记录
-- 在 Supabase SQL Editor 里整段执行一次即可。
-- 每个登录用户只能读写自己的数据（RLS，owner_id = auth.uid()）。

create table if not exists public.applications (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company     text not null,
  group_name  text,                       -- 集团分组（选填）：如「中信银行」聚合多个分行投递
  base        text,
  sub_unit    text,
  position    text,
  link        text,
  remark      text,
  stage       text not null default '投递',
  stage_dates jsonb not null default '{}'::jsonb,
  apply_date  date,
  update_time timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.applications enable row level security;

drop policy if exists "own select" on public.applications;
drop policy if exists "own insert" on public.applications;
drop policy if exists "own update" on public.applications;
drop policy if exists "own delete" on public.applications;

create policy "own select" on public.applications
  for select using (owner_id = auth.uid());
create policy "own insert" on public.applications
  for insert with check (owner_id = auth.uid());
create policy "own update" on public.applications
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own delete" on public.applications
  for delete using (owner_id = auth.uid());

create index if not exists idx_applications_owner   on public.applications(owner_id);
create index if not exists idx_applications_update  on public.applications(update_time desc);

-- 已部署的旧表补列（首次新建表时上面 create table 已含该列，此句幂等，可反复执行）：
alter table public.applications add column if not exists group_name text;

-- ============================================================
-- 备注图片：从 2026-10-05 起需要执行下面这一段（建存储桶 + 权限 + 加列）
-- 在 Supabase SQL Editor 里单独执行一次即可，幂等，可反复执行。
--   1) 建公开桶 remark-media：图片本身要能直接展示，所以桶设为 public；
--      但「谁能写 / 谁能删」由下面两条 storage.objects 策略按 owner_id 目录限制。
--   2) 图片路径统一放在 {用户id}/ 下，策略据此判断归属，跨用户互相看不到也改不了。
--   3) applications.remark_images 存 JSONB 数组，形如
--      [{"path":"<uid>/xxx.jpg","url":"https://.../remark-media/<uid>/xxx.jpg"}]
--      存 path 而不是只存 URL，是为了让「删记录时同步删文件」能拿到对象路径。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('remark-media', 'remark-media', true)
on conflict (id) do nothing;

drop policy if exists "remark-media own insert" on storage.objects;
drop policy if exists "remark-media own delete" on storage.objects;

-- 只有图片路径的第一段等于自己 user id 时，才允许写入 / 删除
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

alter table public.applications add column if not exists remark_images jsonb not null default '[]'::jsonb;
