# 🌊 LeetFlow

> **What is LeetFlow?**
> A personal LeetCode analytics platform. A Chrome extension silently tracks your
> solving activity and syncs it to a database. A React dashboard gives you deep
> analytics on your performance, patterns, and progress — plus a leaderboard to
> compare with other users. No manual input. No setup per problem. Just solve and review.

---

## How it works

LeetFlow has three parts that work together:

| Part | What it does |
|---|---|
| **Chrome Extension** | Runs on `leetcode.com/problems/*`, detects submissions, queues them locally, syncs to Supabase every 5 minutes or immediately on accept |
| **Supabase** | Postgres database with Row Level Security. Each user can only read/write their own data. The leaderboard is the only cross-user surface |
| **React Dashboard** | Reads from Supabase, processes everything client-side, renders analytics. No backend server required |

---

## What you'll need before starting

- [Node.js](https://nodejs.org) v18 or later
- A free [Supabase account](https://supabase.com)
- Google Chrome (for the extension)
- Your LeetFlow project files

---

## Part 1 — Set up Supabase

**Step 1 — Create a project**

Go to [supabase.com](https://supabase.com), click **New Project**, give it a name like
`leetflow`, and wait for it to provision (about 30 seconds).

**Step 2 — Get your credentials**

Go to your project → **Settings → API** and copy:
- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon public key** — a long JWT string

You'll need these in both Part 2 and Part 3.

**Step 3 — Run the schema files**

Go to your project → **SQL Editor** and run these two files in order.
Paste the contents of each and click **Run**.

| Order | File | What it creates |
|---|---|---|
| 1st | `supabase/schema.sql` | `problems`, `sessions`, `bookmarks` tables + RLS policies |
| 2nd | `supabase/leaderboard.sql` | `profiles` table, signup trigger, `get_leaderboard` function |

> ⚠️ **Run them in order.** `leaderboard.sql` depends on tables created by `schema.sql`.
> If you only have one user right now, the leaderboard backfill in Step 2 of
> `leaderboard.sql` will create your profile row automatically.

**Step 4 — Enable Google Auth (optional)**

If you want Google sign-in on the dashboard:
1. Go to **Authentication → Providers → Google**
2. Enable it and follow the setup instructions
3. Add `http://localhost:5173` as a redirect URL under **Authentication → URL Configuration**

> If you prefer email/password login only, skip this step entirely.

---

## Part 2 — Set up the Extension

**Step 5 — Add your Supabase credentials**

Open `extension/config.js` and replace the placeholder values:

```js
export const SUPABASE_URL    = "https://your-project-id.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key-here";
```

**Step 6 — Load the extension in Chrome**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** using the toggle in the top right
3. Click **Load unpacked**
4. Select the `extension/` folder from your project

> ✅ You should see the LeetFlow extension appear in your extensions list and toolbar.

**Step 7 — Sign in to the dashboard first**

The extension reads your auth session from the dashboard's localStorage. Before it can
sync anything, you need to sign in to the dashboard (Part 3) at least once.

---

## Part 3 — Set up the Dashboard

**Step 8 — Install dependencies**

Open a terminal inside the `dashboard/` folder and run:

```bash
npm install
```

**Step 9 — Configure environment variables**

Copy the example file:

```bash
cp .env.example .env
```

Then open `.env` and fill in your values from Step 2:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> ⚠️ The `VITE_` prefix is required. Vite only exposes variables that start with `VITE_`
> to your frontend code. Without it, the dashboard will load but won't connect to Supabase.

**Step 10 — Run locally**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome, sign in, and you're ready.

> ✅ Go to a LeetCode problem and submit a solution. You should see it appear in your
> dashboard within 5 minutes, or instantly after an accepted submission.

---

## Part 4 — Deploy to production

See **DEPLOY.md** for full instructions on deploying the dashboard to Vercel and
updating the extension to point to your live URL.

---

## Dashboard pages

### Dashboard `/`
Your overview. Shows total solved, current streak, average solve time, a 365-day
activity heatmap, time trend chart, difficulty distribution, and recent solves.

### Problems `/problems`
Full table of every tracked problem. Filter by name, difficulty, status, and tag.
Sidebar shows topic mastery bars and smart insights.

### Analytics `/analytics`
Deep performance analysis across 9 charts:

| Chart | What it shows |
|---|---|
| Peak Hours | Which hours of the day you solve most and best |
| Burnout Risk | Flags if you've had too many 2h+ sessions in 14 days |
| Topic-wise Analysis | Problems per tag coloured by success rate |
| Attempts to Success | Donut — 1-try vs 2-try vs 3-5 vs 6+ solves |
| Session Timeline | Derived from session groupings in the problems table |
| This Week vs Last Week | Solved count and avg time comparison |
| First-Try Rate Over Time | Weekly % of problems solved on the first attempt |
| Difficulty Progression | Weekly stacked bar of easy / medium / hard solves |
| Slowest Accepted Solves | Top 8 problems that took the longest to accept |

### Leaderboard `/leaderboard`
Cross-user rankings. Shows a top-3 podium, full rankings table, and your personal
rank strip at the bottom. Filterable by This Week, This Month, or All Time.

#### Points system
| Difficulty | Points per accepted solve |
|---|---|
| Easy | 1 |
| Medium | 3 |
| Hard | 5 |

> Points weights are defined in the `get_leaderboard` SQL function in Supabase.
> To change them, update the function there — no dashboard code changes needed.

---

## Database tables

### `problems`
One row per problem attempt per session. The core table everything is built from.

| Column | Type | Notes |
|---|---|---|
| `problem_name` | text | e.g. `"Two Sum"` |
| `difficulty` | text | `easy`, `medium`, `hard`, `unknown` |
| `tags` | text[] | e.g. `["array", "hash table"]` |
| `time_taken` | integer | Active solving time in seconds |
| `attempts` | integer | Number of submissions |
| `status` | text | `in_progress`, `accepted`, `failed` |
| `started_at` | timestamptz | When the problem was opened |
| `completed_at` | timestamptz | When it was accepted |
| `session_id` | text | Groups problems from the same browser session |

### `bookmarks`
Problems flagged for retry. Stores `problem_name`, `difficulty`, `tags`, and an optional `note`.

### `profiles`
One row per user. Created automatically on signup by a Supabase trigger.
Stores `display_name` derived from the user's email prefix (`john` from `john@gmail.com`).

> The `sessions` table exists in the schema but is not written to by the extension.
> Session data is derived client-side by grouping `problems` rows on `session_id`.

---

## Project structure

```
leetflow/
│
├── extension/
│   ├── manifest.json        # Permissions and content script rules
│   ├── content.js           # Detects submissions on leetcode.com/problems/*
│   ├── background.js        # Queues records, handles sync and token refresh
│   ├── injected.js          # Reads LeetCode's React state (runs in MAIN world)
│   ├── popup.html/js        # Extension popup — shows today's stats
│   ├── config.js            # ← Add your Supabase credentials here
│   └── icons/               # 16px, 48px, 128px PNGs
│
├── dashboard/
│   └── src/
│       ├── App.jsx                       # Router + auth context
│       ├── lib/
│       │   ├── supabase.js               # Supabase client
│       │   ├── dataProcessor.js          # All data transforms — add analytics here
│       │   ├── bookmarks.js              # Bookmark system
│       │   └── useProblems.js            # Shared data hook
│       ├── components/
│       │   ├── Layout.jsx                # Sidebar + header — add nav items here
│       │   ├── UI.jsx                    # Design tokens and shared components
│       │   └── charts/                   # Recharts wrappers
│       └── pages/
│           ├── LoginPage.jsx
│           ├── DashboardPage.jsx
│           ├── ProblemsPage.jsx
│           ├── AnalyticsPage.jsx
│           └── LeaderboardPage.jsx
│
└── supabase/
    ├── schema.sql            # Run first
    └── leaderboard.sql       # Run second
```

---

## Adding a new dashboard page

1. Create `dashboard/src/pages/YourPage.jsx`
2. Add the route in `App.jsx`:
```jsx
<Route path="/your-path" element={<YourPage />} />
```
3. Add the nav item in `Layout.jsx`:
```js
{ to: "/your-path", label: "Your Page", icon: "icon_name" }
```
Icons are from [Google Material Symbols](https://fonts.google.com/icons). Use the
symbol name as the `icon` string.

## Adding a new analytics chart

1. Add a data function to `dataProcessor.js` — export it as a named function
2. Import it in `AnalyticsPage.jsx`
3. Write a component that uses `BentoCard` from `UI.jsx` and your data function
4. Add a grid item inside the 12-column grid in `AnalyticsPage.jsx`

---

## Troubleshooting

**Extension isn't tracking problems**
→ Make sure you signed in to the dashboard first. The extension needs a session from
the dashboard's localStorage. Open the popup and check if it shows your stats.

**Dashboard shows "Error loading data"**
→ Check your `.env` file has both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
set correctly with no extra spaces or quotes.

**Leaderboard shows only my own entry**
→ Other users need to sign up and solve problems before they appear. The leaderboard
only shows users who have at least one problem row in the database.

**Session Timeline shows "No session data yet"**
→ This is expected if you haven't solved any problems through the extension yet.
Sessions are derived from `session_id` groupings in the `problems` table —
solve a few problems and they'll appear.

**Problems are duplicated in the table**
→ The extension deduplicates by `problem_name + date`. If you see duplicates in the
dashboard it means problems were solved across different days or sessions, which is correct.

---

## Setup checklist

- [ ] Supabase project created
- [ ] `supabase/schema.sql` executed in SQL Editor
- [ ] `supabase/leaderboard.sql` executed in SQL Editor
- [ ] `extension/config.js` filled in with Supabase credentials
- [ ] Extension loaded via `chrome://extensions/` → Load unpacked
- [ ] `dashboard/.env` filled in with Supabase credentials
- [ ] `npm install` run inside `dashboard/`
- [ ] Dashboard opens at `localhost:5173` and sign-in works
- [ ] First problem tracked — appears in dashboard within 5 minutes
