-- ============================================================
-- LeetFlow Leaderboard — Run this in Supabase SQL Editor
-- Safe to re-run: use it again to apply updates to get_leaderboard.
-- ============================================================

-- ─── 1. Profiles table ───────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz default now()
);

-- ─── 2. Auto-create profile on new signup ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 3. Backfill existing users ──────────────────────────────────────────────
-- Run once so users who already signed up get a profile row.
insert into public.profiles (user_id, display_name)
select id, split_part(email, '@', 1)
from auth.users
on conflict (user_id) do nothing;

-- ─── 4. RLS on profiles ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

-- ─── 5. Leaderboard RPC function ─────────────────────────────────────────────
-- SECURITY DEFINER bypasses per-row RLS to aggregate across all users.
-- Only aggregated stats are returned — no individual problem rows exposed.
--
-- Each problems row is one problem on one day; its `attempts` column is the
-- number of submissions made. total_submissions sums those (an accepted row
-- always counts at least its accepted submission), and accuracy is accepted
-- solves as a percentage of submissions.
create or replace function public.get_leaderboard(
  date_from timestamptz default null,
  date_to   timestamptz default null
)
returns table (
  user_id           uuid,
  display_name      text,
  total_submissions bigint,
  total_solved      bigint,
  easy_solved       bigint,
  medium_solved     bigint,
  hard_solved       bigint,
  accuracy          numeric,
  points            bigint
)
language sql security definer as $$
  with per_user as (
    select
      p.user_id,
      pr.display_name,
      coalesce(sum(
        case when p.status = 'accepted' then greatest(coalesce(p.attempts, 0), 1)
             else coalesce(p.attempts, 0) end
      ), 0)::bigint                                                              as total_submissions,
      count(*) filter (where p.status = 'accepted')                              as total_solved,
      count(*) filter (where p.status = 'accepted' and p.difficulty = 'easy')    as easy_solved,
      count(*) filter (where p.status = 'accepted' and p.difficulty = 'medium')  as medium_solved,
      count(*) filter (where p.status = 'accepted' and p.difficulty = 'hard')    as hard_solved
    from public.problems p
    join public.profiles pr on pr.user_id = p.user_id
    where
      (date_from is null or p.started_at >= date_from) and
      (date_to   is null or p.started_at <= date_to)
    group by p.user_id, pr.display_name
  )
  select
    u.user_id,
    u.display_name,
    u.total_submissions,
    u.total_solved,
    u.easy_solved,
    u.medium_solved,
    u.hard_solved,
    coalesce(round(u.total_solved::numeric / nullif(u.total_submissions, 0) * 100, 1), 0) as accuracy,
    (u.easy_solved * 1 + u.medium_solved * 3 + u.hard_solved * 5)                          as points
  from per_user u
  order by points desc;
$$;
