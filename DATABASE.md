# 🗄️ LeetFlow Database

LeetFlow uses a Supabase (Postgres) project. Everything is created by two SQL files,
run in the Supabase **SQL Editor** in this order:

| Order | File | Creates |
|---|---|---|
| 1st | `supabase/schema.sql` | `problems`, `bookmarks`, RLS policies, constraints, `updated_at` trigger |
| 2nd | `supabase/leaderboard.sql` | `profiles`, signup trigger, `get_leaderboard()` |

**Both files are safe to re-run.** To apply changes to an existing project, run both again
in the same order — they use `if not exists` / `drop … if exists` throughout and never
delete your data.

---

## Tables

### `problems`

One row per **user + problem + day**. The extension creates and updates rows through the
REST API (an upsert on `(user_id, problem_name, session_id)`), so repeat visits to a
problem on the same day update one row.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | → `auth.users`, cascades on delete |
| `problem_name` | text | URL slug, e.g. `two-sum` — the problem's identity |
| `problem_title` | text | Display title, e.g. `1. Two Sum`; null on older rows |
| `difficulty` | text | `easy` / `medium` / `hard` / `unknown` |
| `tags` | text[] | Topic tags, lowercased |
| `time_taken` | integer | Active seconds; 0–86400 |
| `attempts` | integer | Submissions up to and including the accepted one; 0–1000 |
| `status` | text | `in_progress` / `accepted` / `failed` |
| `started_at` | timestamptz | First opened that day |
| `completed_at` | timestamptz | Accepted at |
| `session_id` | text | `session_YYYY-MM-DD` (the user's local day) |
| `created_at`, `updated_at` | timestamptz | `updated_at` is set by a trigger on every update |

Unique key: `(user_id, problem_name, session_id)`.
Indexes: `(user_id, started_at desc)`, `(user_id, status)`.

The `time_taken` and `attempts` range checks are `NOT VALID`: they apply to new and
updated rows without rejecting anything already stored.

### `bookmarks`

Problems flagged for retry from the Problems page. Unique on `(user_id, problem_name)`;
`problem_name` is the slug, matching `problems.problem_name`.

### `profiles`

| Column | Notes |
|---|---|
| `user_id` | Primary key → `auth.users` |
| `display_name` | Shown on the leaderboard; 2–32 characters |

A row is created on signup by the `on_auth_user_created` trigger, with an anonymous
handle like `coder-3f9a1c` (`default_display_name()`). Users change their name from the
Leaderboard page.

> Earlier versions used the part of the email before the `@` as the display name, which
> exposed it to every user. Re-running `leaderboard.sql` replaces any name that still
> equals the user's email prefix with the anonymous handle.

---

## Row Level Security

RLS is enabled on every table.

| Table | Who can do what |
|---|---|
| `problems` | Users select, insert, update and delete only their own rows |
| `bookmarks` | Users select, insert and delete only their own rows |
| `profiles` | Any signed-in user can read display names; users update only their own |

---

## Functions

### `get_leaderboard(date_from timestamptz, date_to timestamptz)`

The only cross-user view. It runs with owner rights (`SECURITY DEFINER`) to aggregate
across users, and returns only aggregates — no problem rows and no user ids:

| Column | Meaning |
|---|---|
| `display_name` | From `profiles` |
| `is_current_user` | True on the caller's own row |
| `total_submissions` | Sum of `attempts` (an accepted row counts at least 1) |
| `total_solved` | Distinct problems with an accepted row |
| `easy_solved`, `medium_solved`, `hard_solved` | Distinct solved problems by difficulty |
| `accuracy` | Accepted submissions ÷ submissions × 100 |
| `points` | Easy 1, Medium 3, Hard 5 — per distinct solved problem |

Rows are filtered by `started_at` and ordered by points. Only the `authenticated` role
can call it (execute is revoked from `anon`).

### Others

| Function | Purpose |
|---|---|
| `set_updated_at()` | Trigger: keeps `problems.updated_at` current |
| `handle_new_user()` | Trigger on `auth.users`: creates the `profiles` row |
| `default_display_name(uuid)` | The anonymous `coder-xxxxxx` handle |

All functions pin `search_path`, so they can't be redirected to objects in other schemas.

---

## Security notes

- Rows are written by each user's own extension with their own token, so leaderboard
  stats are self-reported: RLS stops users writing to *other* accounts, not inflating
  their own. The range checks only catch impossible values.
- The publishable/anon key in `extension/config.js` and the dashboard is meant to be
  public; RLS is what protects the data.

---

## Removed objects (existing projects)

Re-running `schema.sql` cleans these up where it can:

- **`upsert_problem()`** — dropped automatically. It ran with owner rights and accepted a
  user id parameter, so any client could write into any account. Nothing used it.
- **`sessions` table** — never written to and no longer created. It's left in place on
  existing projects; remove it with `drop table if exists public.sessions;` if you like.
