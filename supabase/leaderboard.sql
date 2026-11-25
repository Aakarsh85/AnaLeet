-- ============================================================
-- LeetFlow Leaderboard — Run this in Supabase SQL Editor
-- Run schema.sql first. Safe to re-run: use it again to apply updates.
-- ============================================================

-- ─── 1. Profiles table ───────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz default now()
);

-- Display names are shown to every signed-in user. NOT VALID: applies to new
-- and changed names without failing on existing ones.
alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles add constraint profiles_display_name_length
  check (char_length(btrim(display_name)) between 2 and 32) not valid;

-- ─── 2. Default display name ─────────────────────────────────────────────────
-- An anonymous handle such as "coder-3f9a1c". Names used to be the part of
-- the email before the "@", which exposed that to every other user.
create or replace function public.default_display_name(uid uuid)
returns text language sql immutable
set search_path = ''
as $$
  select 'coder-' || substr(replace(uid::text, '-', ''), 1, 6);
$$;

-- ─── 3. Auto-create profile on new signup ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, public.default_display_name(new.id))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 4. Backfill and anonymise existing profiles ─────────────────────────────
-- Give users who signed up before this script a profile row.
insert into public.profiles (user_id, display_name)
select id, public.default_display_name(id)
from auth.users
on conflict (user_id) do nothing;

-- Replace names that are still the email prefix with the anonymous handle.
-- Users can pick a new name on the Leaderboard page.
update public.profiles pr
set display_name = public.default_display_name(pr.user_id)
from auth.users u
where u.id = pr.user_id
  and pr.display_name = split_part(u.email, '@', 1);

-- ─── 5. RLS on profiles ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── 6. Leaderboard RPC function ─────────────────────────────────────────────
-- SECURITY DEFINER bypasses per-row RLS to aggregate across all users.
-- Only aggregated stats are returned — no problem rows and no user ids; the
-- caller's own row is flagged with is_current_user.
--
-- Each problems row is one problem on one day. Solving the same problem on
-- several days counts once: total_solved and points are per distinct problem.
-- total_submissions sums the attempts column (an accepted row always counts at
-- least its accepted submission); accuracy is accepted submissions as a
-- percentage of all submissions.
drop function if exists public.get_leaderboard(timestamptz, timestamptz);
create function public.get_leaderboard(
  date_from timestamptz default null,
  date_to   timestamptz default null
)
returns table (
  display_name      text,
  is_current_user   boolean,
  total_submissions bigint,
  total_solved      bigint,
  easy_solved       bigint,
  medium_solved     bigint,
  hard_solved       bigint,
  accuracy          numeric,
  points            bigint
)
language sql stable security definer
set search_path = ''
as $$
  with per_problem as (
    select
      p.user_id,
      p.problem_name,
      bool_or(p.status = 'accepted')                                   as solved,
      max(p.difficulty) filter (
        where p.status = 'accepted' and p.difficulty in ('easy', 'medium', 'hard')
      )                                                                 as difficulty,
      count(*) filter (where p.status = 'accepted')                     as accepted_submissions,
      sum(
        case when p.status = 'accepted' then greatest(coalesce(p.attempts, 0), 1)
             else coalesce(p.attempts, 0) end
      )                                                                 as submissions
    from public.problems p
    where
      (date_from is null or p.started_at >= date_from) and
      (date_to   is null or p.started_at <= date_to)
    group by p.user_id, p.problem_name
  ),
  per_user as (
    select
      pp.user_id,
      pr.display_name,
      coalesce(sum(pp.submissions), 0)::bigint                          as total_submissions,
      coalesce(sum(pp.accepted_submissions), 0)::bigint                 as accepted_submissions,
      count(*) filter (where pp.solved)                                 as total_solved,
      count(*) filter (where pp.solved and pp.difficulty = 'easy')      as easy_solved,
      count(*) filter (where pp.solved and pp.difficulty = 'medium')    as medium_solved,
      count(*) filter (where pp.solved and pp.difficulty = 'hard')      as hard_solved
    from per_problem pp
    join public.profiles pr on pr.user_id = pp.user_id
    group by pp.user_id, pr.display_name
  )
  select
    u.display_name,
    u.user_id = auth.uid()                                              as is_current_user,
    u.total_submissions,
    u.total_solved,
    u.easy_solved,
    u.medium_solved,
    u.hard_solved,
    coalesce(round(u.accepted_submissions::numeric / nullif(u.total_submissions, 0) * 100, 1), 0)
                                                                        as accuracy,
    (u.easy_solved * 1 + u.medium_solved * 3 + u.hard_solved * 5)       as points
  from per_user u
  order by points desc, total_solved desc, accuracy desc, display_name;
$$;

-- Only signed-in users may call it. Supabase grants EXECUTE on new functions
-- to the anon role by default, so revoke that explicitly.
revoke all on function public.get_leaderboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_leaderboard(timestamptz, timestamptz) to authenticated;
