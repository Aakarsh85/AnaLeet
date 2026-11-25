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
| **Chrome Extension** | Runs on `leetcode.com`, tracks active time on `/problems/*` pages, detects submissions, queues records locally, syncs to Supabase every 5 minutes or immediately on accept |
| **Supabase** | Postgres database with Row Level Security. Each user can only read/write their own data. The leaderboard is the only cross-user surface |
| **React Dashboard** | Reads from Supabase, processes everything client-side, renders analytics. No backend server required |

---

## What you'll need before starting

- [Node.js](https://nodejs.org) v18 or later (v22 or later to run the tests)
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
- **anon / publishable key**

You'll need these in both Part 2 and Part 3.

**Step 3 — Run the schema files**

Go to your project → **SQL Editor** and run these two files in order.
Paste the contents of each and click **Run**.

| Order | File | What it creates |
|---|---|---|
| 1st | `supabase/schema.sql` | `problems` and `bookmarks` tables, RLS policies, constraints |
| 2nd | `supabase/leaderboard.sql` | `profiles` table, signup trigger, `get_leaderboard` function |

> ⚠️ **Run them in order.** `leaderboard.sql` depends on tables created by `schema.sql`.
> Both files are safe to re-run: **after pulling changes, run both again** to update an
> existing project. See [DATABASE.md](DATABASE.md) for what each one sets up.

**Step 4 — Enable Google Auth (optional)**

If you want Google sign-in on the dashboard:
1. Go to **Authentication → Providers → Google**
2. Enable it and follow the setup instructions
3. Add `http://localhost:5173` as a redirect URL under **Authentication → URL Configuration**

> If you prefer email/password login only, skip this step entirely.

---

## Part 2 — Set up the Extension

**Step 5 — Point the extension at your project**

`extension/config.js` ships with the values for the original LeetFlow deployment.
To use your own project, replace them:

```js
export const SUPABASE_URL      = "https://your-project-id.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key-here";
export const DASHBOARD_URL     = "https://your-dashboard.example.com/";
```

Then put the same dashboard address in `extension/manifest.json` — in
`host_permissions` and in the `matches` of the `auth-bridge.js` content script — since a
manifest can't read `config.js`.

> The anon/publishable key is designed to be public; access is enforced by RLS.

**Step 6 — Load the extension in Chrome**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** using the toggle in the top right
3. Click **Load unpacked**
4. Select the `extension/` folder from your project

> ✅ You should see the LeetFlow extension appear in your extensions list and toolbar.

**Step 7 — Sign in to the dashboard**

The extension has no login of its own: it uses the session from the dashboard at
`DASHBOARD_URL`. Sign in there (Part 3, or your deployed dashboard) and the extension
picks it up automatically; signing out of the dashboard signs the extension out too.

> **Local development:** the extension only talks to the dashboard address in its
> manifest. To use it with a dashboard on `http://localhost:5173`, set `DASHBOARD_URL`
> to that address and add `http://localhost:5173/*` to the `auth-bridge.js` matches in
> `manifest.json`, then reload the extension.

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
> to your frontend code. Without them the dashboard logs a configuration error in the
> browser console and can't connect to Supabase.

**Step 10 — Run locally**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome, sign in, and you're ready.

> ✅ Go to a LeetCode problem and submit a solution. It appears in your dashboard within
> 5 minutes, or right after an accepted submission. The dashboard refreshes its data
> when you come back to the tab.

---

## Part 4 — Deploy to production

See **DEPLOY.md** for full instructions on deploying the dashboard to Vercel and
updating the extension to point to your live URL.

`npm run build` also packages `extension/` into `dashboard/public/leetflow-extension.zip`
— the file behind the dashboard's **Download Extension** link — so the download always
matches the extension source.

---

## Dashboard pages

### Dashboard `/`
Your overview. Shows distinct problems solved, current streak, average solve time, a
365-day activity heatmap, time trend chart, difficulty split, and recent solves.

### Problems `/problems`
Full table of every tracked problem (one row per problem per day). Filter by name,
difficulty, status, tag, or bookmarked; bookmark problems to retry; export the filtered
rows as CSV. Sidebar shows topic mastery bars and smart insights.

### Analytics `/analytics`
Deep performance analysis across 9 charts, with a 7d / 30d / 90d / All range filter:

| Chart | What it shows |
|---|---|
| Peak Hours | Which hours of the day you solve most and best |
| Burnout Risk | Flags if you've had too many 2h+ days in the last 14 days |
| Topic-wise Analysis | Problems per tag coloured by success rate |
| Attempts to Success | Donut — 1-try vs 2-try vs 3-5 vs 6+ solves |
| Session Timeline | Time and problems per day |
| This Week vs Last Week | Solved count and avg time, last 7 days vs the 7 before |
| First-Try Rate Over Time | Weekly % of problems solved on the first attempt |
| Difficulty Progression | Weekly stacked bar of easy / medium / hard solves |
| Slowest Accepted Solves | Top 8 problems that took the longest to accept |

### Leaderboard `/leaderboard`
Cross-user rankings. Shows a top-3 podium, full rankings table, and your personal
rank strip at the bottom, where you can change your display name. Filterable by
This Week, This Month, or All Time.

#### Points system
| Difficulty | Points per solved problem |
|---|---|
| Easy | 1 |
| Medium | 3 |
| Hard | 5 |

Each problem counts once, however many days you solve it. **Submissions** is the total
number of submissions made, and **accuracy** is accepted submissions as a percentage of
all submissions.

> Points weights are defined in the `get_leaderboard` SQL function in Supabase.
> To change them, update the function there — no dashboard code changes needed.

> Display names default to an anonymous handle like `coder-3f9a1c`; nobody's email is
> shown to other users. Stats are reported by each user's extension, so the leaderboard
> is only as trustworthy as its participants.

---

## How tracking works

- **One row per problem per day** (in your local time zone). Reloading the page or coming
  back to a problem later the same day continues the same row.
- **Active time** counts while the tab is visible. Time between two moments of activity
  (typing, mouse, scrolling, switching tabs) counts only if the gap is under 30 minutes —
  a longer gap means you were away. Time stops at the accepted submission.
- **Attempts** are submissions up to and including the accepted one.
- **Status:** `in_progress` while you work; `accepted` once accepted; `failed` when you
  leave without an accepted submission after at least 100 seconds of active time (shorter
  visits aren't recorded). The dashboard also shows an `in_progress` row as Failed once it
  hasn't been updated for an hour (e.g. the tab was closed before the extension could report).

---

## Database tables

See [DATABASE.md](DATABASE.md) for the full reference.

### `problems`
The core table everything is built from.

| Column | Type | Notes |
|---|---|---|
| `problem_name` | text | The problem's URL slug, e.g. `"two-sum"` — its identity |
| `problem_title` | text | Display title, e.g. `"1. Two Sum"` (older rows: derived from the slug) |
| `difficulty` | text | `easy`, `medium`, `hard`, `unknown` |
| `tags` | text[] | e.g. `["array", "hash table"]` |
| `time_taken` | integer | Active solving time in seconds |
| `attempts` | integer | Number of submissions |
| `status` | text | `in_progress`, `accepted`, `failed` |
| `started_at` | timestamptz | When the problem was first opened that day |
| `completed_at` | timestamptz | When it was accepted |
| `session_id` | text | `session_YYYY-MM-DD` — the day; part of the row's unique key |

### `bookmarks`
Problems flagged for retry from the Problems page. Stores `problem_name`, `difficulty`, `tags`, and an optional `note`.

### `profiles`
One row per user, created automatically on signup. Stores the `display_name` shown on
the leaderboard.

---

## Project structure

```
leetflow/
│
├── extension/
│   ├── manifest.json        # Permissions and content script rules
│   ├── config.js            # ← Supabase project + dashboard URL
│   ├── content.js           # Tracks time and submissions on leetcode.com
│   ├── injected.js          # Reads LeetCode's network responses (runs in MAIN world)
│   ├── background.js        # Queues records, syncs, manages the auth session
│   ├── auth-bridge.js       # Shares the sign-in session with the dashboard
│   ├── popup.html/js/css    # Extension popup — live timer and today's stats
│   └── icons/               # 16px, 48px, 128px PNGs
│
├── dashboard/
│   ├── scripts/
│   │   └── build-extension-zip.mjs   # Packages extension/ for the download link
│   └── src/
│       ├── App.jsx                       # Router + auth context
│       ├── lib/
│       │   ├── supabase.js               # Supabase client
│       │   ├── dataProcessor.js          # All data transforms — add analytics here
│       │   ├── useProblems.js            # Shared data provider used by every page
│       │   └── bookmarks.js              # Bookmark system
│       ├── components/
│       │   ├── Layout.jsx                # Sidebar + header — add nav items here
│       │   ├── UI.jsx                    # Design tokens and shared components
│       │   ├── DateRangeFilter.jsx       # 7d / 30d / 90d / All selector
│       │   └── charts/                   # Recharts wrappers
│       └── pages/
│           ├── LoginPage.jsx
│           ├── DashboardPage.jsx
│           ├── ProblemsPage.jsx
│           ├── AnalyticsPage.jsx
│           └── LeaderboardPage.jsx
│
├── supabase/
│   ├── schema.sql            # Run first (safe to re-run)
│   └── leaderboard.sql       # Run second (safe to re-run)
│
├── tests/                    # node:test suites for the dashboard and the extension
└── .github/workflows/ci.yml  # Runs the tests and the build on every push
```

---

## Development

From the `dashboard/` folder:

| Command | What it does |
|---|---|
| `npm run dev` | Start the dashboard on `localhost:5173` |
| `npm test` | Run all tests (Node 22+): dashboard data processing, the extension's tracker, background worker and auth bridge |
| `npm run build` | Rebuild the extension zip, then build the dashboard into `dist/` |
| `npm run build:extension` | Only rebuild `public/leetflow-extension.zip` |

## Adding a new dashboard page

1. Create `dashboard/src/pages/YourPage.jsx` and get data with `const { problems } = useProblems();`
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

1. Add a data function to `dataProcessor.js` — export it as a named function, and add a test in `tests/dashboard/`
2. Import it in `AnalyticsPage.jsx`
3. Write a component that uses `BentoCard` from `UI.jsx` and your data function
4. Add a grid item inside the 12-column grid in `AnalyticsPage.jsx`

---

## Troubleshooting

**Extension isn't tracking problems**
→ Make sure you're signed in to the dashboard at the address in `config.js`. Open the
popup's settings to see whether it's signed in, and use the sync button to sync now.

**Dashboard shows "Error loading data"**
→ Check your `.env` file has both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
set correctly with no extra spaces or quotes, and that both SQL files have been run.

**Extension console says "Database has no problem_title column"**
→ Re-run `supabase/schema.sql`. Syncing keeps working without the column, but titles aren't stored.

**Leaderboard shows only my own entry**
→ Other users need to sign up and solve problems before they appear. The leaderboard
only shows users who have at least one problem row in the database.

**Session Timeline shows "No session data yet"**
→ This is expected if you haven't solved any problems through the extension yet.

**The same problem appears more than once in the table**
→ There's one row per problem per day, so it was worked on on different days, which is correct.

---

## Setup checklist

- [ ] Supabase project created
- [ ] `supabase/schema.sql` executed in SQL Editor
- [ ] `supabase/leaderboard.sql` executed in SQL Editor
- [ ] `extension/config.js` (and the dashboard URL in `manifest.json`) point at your project
- [ ] Extension loaded via `chrome://extensions/` → Load unpacked
- [ ] `dashboard/.env` filled in with Supabase credentials
- [ ] `npm install` run inside `dashboard/`
- [ ] Dashboard opens and sign-in works
- [ ] First problem tracked — appears in dashboard within 5 minutes
