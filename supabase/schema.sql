-- ============================================================
-- LeetFlow Database Schema
-- Run this in your Supabase SQL editor to set up the database.
-- Safe to re-run: run it again to apply updates to an existing project.
-- ============================================================

-- ─── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Problems table ───────────────────────────────────────────────────────────
-- One row per problem per day. problem_name is the problem's URL slug
-- (e.g. "two-sum") and is the stable identity; problem_title is the
-- display title (e.g. "1. Two Sum").
create table if not exists public.problems (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  problem_name  text not null,
  problem_title text,
  difficulty    text check (difficulty in ('easy','medium','hard','unknown')),
  tags          text[] default '{}',
  time_taken    integer default 0,           -- seconds of active time
  attempts      integer default 1,
  status        text default 'in_progress'
                  check (status in ('in_progress','accepted','failed')),
  started_at    timestamptz,
  completed_at  timestamptz,
  session_id    text,                        -- "session_YYYY-MM-DD" (local day)
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  -- One row per user + problem + day
  unique (user_id, problem_name, session_id)
);

-- Added after the first release
alter table public.problems add column if not exists problem_title text;

-- Basic sanity limits on client-reported values. A row covers one day, so
-- active time can't exceed 24 hours. NOT VALID: applies to new and updated
-- rows without failing on any existing data.
alter table public.problems drop constraint if exists problems_time_taken_range;
alter table public.problems add constraint problems_time_taken_range
  check (time_taken between 0 and 86400) not valid;

alter table public.problems drop constraint if exists problems_attempts_range;
alter table public.problems add constraint problems_attempts_range
  check (attempts between 0 and 1000) not valid;

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
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_problems_updated_at on public.problems;
create trigger trg_problems_updated_at
  before update on public.problems
  for each row execute function public.set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table public.problems  enable row level security;
alter table public.bookmarks enable row level security;

-- Problems: users can only see/modify their own rows
drop policy if exists "problems_select_own" on public.problems;
create policy "problems_select_own" on public.problems
  for select using (auth.uid() = user_id);

drop policy if exists "problems_insert_own" on public.problems;
create policy "problems_insert_own" on public.problems
  for insert with check (auth.uid() = user_id);

drop policy if exists "problems_update_own" on public.problems;
create policy "problems_update_own" on public.problems
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "problems_delete_own" on public.problems;
create policy "problems_delete_own" on public.problems
  for delete using (auth.uid() = user_id);

-- Bookmarks
drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own" on public.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists "bookmarks_insert_own" on public.bookmarks;
create policy "bookmarks_insert_own" on public.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists "bookmarks_delete_own" on public.bookmarks;
create policy "bookmarks_delete_own" on public.bookmarks
  for delete using (auth.uid() = user_id);

-- ─── Helpful indexes ─────────────────────────────────────────────────────────
create index if not exists idx_problems_user_started
  on public.problems (user_id, started_at desc);

create index if not exists idx_problems_user_status
  on public.problems (user_id, status);

-- ─── Removed objects ─────────────────────────────────────────────────────────
-- upsert_problem() ran with owner rights and accepted any user id, so any
-- client could write rows into another user's account. The extension never
-- used it (it upserts through the REST API under RLS).
drop function if exists public.upsert_problem(
  uuid, text, text, text[], integer, integer, text, timestamptz, timestamptz, text
);

-- The old "sessions" table was never written to and is no longer created.
-- On an existing project it can be removed with:
--   drop table if exists public.sessions;
