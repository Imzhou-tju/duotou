-- 多投 · 秋招投递记录
-- 在 Supabase SQL Editor 里整段执行一次即可。
-- 每个登录用户只能读写自己的数据（RLS，owner_id = auth.uid()）。

create table if not exists public.applications (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company     text not null,
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
