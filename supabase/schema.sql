-- ============================================================
-- LeetFlow Database Schema
-- Run this in your Supabase SQL editor to set up the database.
-- ============================================================

-- ─── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Sessions table ───────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  start_time    timestamptz not null default now(),
  end_time      timestamptz,
  total_time    integer default 0,           -- seconds
  problems_solved integer default 0,
  created_at    timestamptz default now()
);

-- ─── Problems table ───────────────────────────────────────────────────────────
create table if not exists public.problems (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  problem_name  text not null,
  difficulty    text check (difficulty in ('easy','medium','hard','unknown')),
  tags          text[] default '{}',
  time_taken    integer default 0,           -- seconds of active time
  attempts      integer default 1,
  status        text default 'in_progress'
                  check (status in ('in_progress','accepted','failed')),
  started_at    timestamptz,
  completed_at  timestamptz,
  session_id    text,                        -- references session uuid as text
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  -- Prevent duplicate problem+session combos for same user
  unique (user_id, problem_name, session_id)
);

-- ─── Bookmarks table ─────────────────────────────────────────────────────────
create table if not exists public.bookmarks (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  problem_name  text not null,
  difficulty    text,
  tags          text[] default '{}',
  note          text,
  created_at    timestamptz default now(),
  unique (user_id, problem_name)
);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_problems_updated_at
  before update on public.problems
  for each row execute function public.set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table public.problems  enable row level security;
alter table public.sessions  enable row level security;
alter table public.bookmarks enable row level security;

-- Problems: users can only see/modify their own rows
create policy "problems_select_own" on public.problems
  for select using (auth.uid() = user_id);

create policy "problems_insert_own" on public.problems
  for insert with check (auth.uid() = user_id);

create policy "problems_update_own" on public.problems
  for update using (auth.uid() = user_id);

create policy "problems_delete_own" on public.problems
  for delete using (auth.uid() = user_id);

-- Sessions: same pattern
create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = user_id);

create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = user_id);

create policy "sessions_update_own" on public.sessions
  for update using (auth.uid() = user_id);

-- Bookmarks
create policy "bookmarks_select_own" on public.bookmarks
  for select using (auth.uid() = user_id);

create policy "bookmarks_insert_own" on public.bookmarks
  for insert with check (auth.uid() = user_id);

create policy "bookmarks_delete_own" on public.bookmarks
  for delete using (auth.uid() = user_id);

-- ─── Helpful indexes ─────────────────────────────────────────────────────────
create index if not exists idx_problems_user_started
  on public.problems (user_id, started_at desc);

create index if not exists idx_problems_user_status
  on public.problems (user_id, status);

create index if not exists idx_sessions_user_start
  on public.sessions (user_id, start_time desc);

-- ─── Upsert function (called by extension sync) ───────────────────────────────
-- Merges a problem row: on conflict keep the max time_taken and attempts.
create or replace function public.upsert_problem(
  p_user_id       uuid,
  p_problem_name  text,
  p_difficulty    text,
  p_tags          text[],
  p_time_taken    integer,
  p_attempts      integer,
  p_status        text,
  p_started_at    timestamptz,
  p_completed_at  timestamptz,
  p_session_id    text
) returns void language plpgsql security definer as $$
begin
  insert into public.problems
    (user_id, problem_name, difficulty, tags, time_taken, attempts,
     status, started_at, completed_at, session_id)
  values
    (p_user_id, p_problem_name, p_difficulty, p_tags, p_time_taken, p_attempts,
     p_status, p_started_at, p_completed_at, p_session_id)
  on conflict (user_id, problem_name, session_id) do update set
    time_taken   = greatest(excluded.time_taken,   public.problems.time_taken),
    attempts     = greatest(excluded.attempts,      public.problems.attempts),
    status       = case when excluded.status = 'accepted' then 'accepted'
                        else public.problems.status end,
    completed_at = coalesce(excluded.completed_at, public.problems.completed_at),
    tags         = case when array_length(excluded.tags,1) > 0
                        then excluded.tags else public.problems.tags end,
    difficulty   = case when excluded.difficulty <> 'unknown'
                        then excluded.difficulty else public.problems.difficulty end;
end;
$$;
