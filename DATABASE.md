# 🚀 LeetFlow — LeetCode Performance Analytics System

A **silent-tracking Chrome extension + React analytics dashboard** that automatically measures your LeetCode problem-solving performance and surfaces meaningful insights.

---

## 📁 Project Structure

```
leetflow/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json        # Extension config & permissions
│   ├── content.js           # Silent tracker (runs on leetcode.com/problems/*)
│   ├── background.js        # Service worker — storage, sync, alarms
│   ├── popup.html           # Extension popup UI
│   ├── popup.js             # Popup logic
│   ├── injected.js          # Runs in the MAIN world (page context) Communicates back to content.js via window.postMessage.
│   ├── config.js            # ← Add your Supabase credentials here
│   └── icons/               # Extension icons (add 16, 48, 128px PNGs)
│
├── dashboard/               # React + Vite analytics dashboard
│   ├── src/
│   │   ├── App.jsx          # Router + auth context
│   │   ├── main.jsx         # Entry point
│   │   ├── lib/
│   │   │   ├── supabase.js  # Supabase client
│   │   │   ├── dataProcessor.js  # All data transforms (client-side)
│   │   │   ├── bookmarks.js # Bookmark/retry system
│   │   │   └── useProblems.js    # Shared data hook
│   │   ├── components/
│   │   │   ├── Layout.jsx   # Sidebar + header shell
│   │   │   ├── UI.jsx       # Design system components
│   │   │   ├── DateRangeFilter.jsx
│   │   │   └── charts/
│   │   │       ├── ActivityHeatmap.jsx
│   │   │       ├── TimeTrendChart.jsx
│   │   │       ├── TopicChart.jsx
│   │   │       └── PerformanceCharts.jsx
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── DashboardPage.jsx  # Overview + heatmap + trends
│   │       ├── ProblemsPage.jsx   # Table + filters + insights
│   │       └── AnalyticsPage.jsx  # Deep analytics + burnout + sessions
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── supabase/
    └── schema.sql           # Run this in Supabase SQL editor
```

---

## ⚡ Quick Setup (15 minutes)

### Step 1 — Create Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Open **SQL Editor** and run the contents of `supabase/schema.sql`
3. Go to **Settings → API** and copy:
   - Project URL
   - `anon` / `public` key

### Step 2 — Configure the extension

Edit `extension/config.js`:
```js
export const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```

### Step 3 — Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin LeetFlow from the extensions toolbar

### Step 4 — Set up the dashboard

```bash
cd dashboard
cp .env.example .env
# Edit .env with your Supabase credentials

npm install
npm run dev
# Opens at http://localhost:5173
```

### Step 5 — Sign in

Open `http://localhost:5173` → sign in with Google or email.

> The extension popup shows a link to open your dashboard. After signing in, the extension automatically gets your session token via `chrome.storage.local`.

---

## 🧩 How Tracking Works

```
LeetCode page loaded
  └── content.js activates silently
        ├── Scrapes problem title, difficulty, tags from DOM
        ├── Waits for first keyboard/mouse interaction
        ├── Starts active-time ticker (pauses on idle >60s or tab hidden)
        ├── Intercepts fetch() to /graphql (passive — no request modification)
        │     └── Detects submission results and accepted status
        └── Flushes to background.js every 5 min + on accepted + on page leave

background.js
  ├── Stores records in chrome.storage.local (offline-safe queue)
  ├── Deduplicates by problem_name + session_id
  ├── Syncs to Supabase on accepted submission
  ├── Runs alarm every 5 minutes to sync the queue
  └── Updates local streak/stats counters

dashboard
  └── Fetches raw data from Supabase
        └── Processes entirely client-side (no pre-aggregation)
              ├── Activity heatmap (365 days)
              ├── Time trend with 7-problem moving average
              ├── Difficulty distribution
              ├── Topic-wise success rate + avg time
              ├── Hourly peak performance analysis
              ├── Burnout risk meter (sessions > 2h)
              ├── Weekly self-comparison
              └── Smart insights engine (AI-style text insights)
```

---

## 📊 Dashboard Pages

| Page | What you see |
|------|-------------|
| **Dashboard** | Total solved, streak, avg time, 365-day heatmap, time trend, difficulty distribution, recent solves, smart insights |
| **Problems** | Filterable table (search, difficulty, tag, status), topic mastery bars, insight panel |
| **Analytics** | Peak hours bar chart, burnout risk meter, topic analysis, attempts efficiency pie, session timeline, week-over-week comparison |

---

## 🔐 Security & Privacy

- Uses **Row Level Security** — users can only read/write their own data
- Extension only **reads** DOM and **listens** to network responses — never modifies them
- No LeetCode actions are automated
- Auth token stored in `chrome.storage.local` (not localStorage)

---

## 🚢 Deploy Dashboard (Optional)

```bash
cd dashboard
npm run build
# Deploy the dist/ folder to Vercel, Netlify, or any static host
```

Update `DASHBOARD_URL` in `extension/popup.js` to your deployed URL.

---

## 🧠 Smart Insights Engine

Generates natural-language insights including:
- **Slowest topic detection** — "You average 34m on DP problems"
- **Fatigue pattern detection** — "Success rate drops after 60 min sessions"
- **Peak performance hours** — "You solve best at 21:00–22:00"
- **Weekly progress comparison** — "+23% problems this week vs last"

---

## 🔄 Extending the System

### Add a new metric
1. Write a pure function in `src/lib/dataProcessor.js`
2. Use it in any page/chart component
3. Always process raw data — never store aggregates in Supabase

### Add a new chart
1. Create `src/components/charts/YourChart.jsx`
2. Import Recharts components
3. Use `BentoCard` wrapper from `UI.jsx` for consistent styling
4. Add to any page's grid layout

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome MV3, Vanilla JS, Tailwind CDN |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Dashboard | React 18 + Vite |
| Charts | Recharts |
| Date utils | date-fns |
| Styling | Inline styles (Deep Logic design system) |
