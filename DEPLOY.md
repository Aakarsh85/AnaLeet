# 🚀 Deploying LeetFlow Dashboard to Vercel

> **Why Vercel?**
> LeetFlow uses React + Vite — Vercel detects this automatically with zero configuration.
> Deploys take under 60 seconds, you get a live HTTPS URL instantly, and every future
> `git push` re-deploys automatically.

---

## What you'll need before starting

- Your LeetFlow project pushed to a GitHub repository
- Your Supabase **Project URL** and **anon key** (from Supabase → Settings → API)
- A free [Vercel account](https://vercel.com/signup) (sign up with GitHub — same account, one click)

---

## Part 1 — Push your project to GitHub

If you haven't done this yet, do it now. Vercel deploys directly from GitHub.

**Step 1 — Create a new repo on GitHub**

Go to [github.com/new](https://github.com/new), give it a name like `leetflow`, set it to
Private, and click **Create repository**. Don't add a README or .gitignore — your project
already has files.

**Step 2 — Push your local project**

Open a terminal in your `leetflow/` root folder and run:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/leetflow.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

> ✅ You should now see all your files at `github.com/YOUR_USERNAME/leetflow`

---

## Part 2 — Deploy on Vercel

**Step 3 — Import your repo into Vercel**

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Continue with GitHub** and authorize Vercel if prompted
3. Find your `leetflow` repo in the list and click **Import**

**Step 4 — Configure the project settings**

Vercel will show a configuration screen. Fill it in exactly like this:

| Setting | Value |
|---|---|
| **Framework Preset** | Vite *(Vercel auto-detects this)* |
| **Root Directory** | `dashboard` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |

> ⚠️ **The Root Directory step is critical.** Your dashboard lives inside `leetflow/dashboard/`,
> not at the repo root. Click **Edit** next to Root Directory and type `dashboard`.
> If you skip this, Vercel won't find your `package.json` and the build will fail.

**Step 5 — Add your environment variables**

Still on the same configuration screen, scroll down to **Environment Variables**.
Add these two variables — click **Add** after each one:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `your-anon-key-here` |

Get the exact values from your Supabase dashboard → **Settings → API**.

> ⚠️ The `VITE_` prefix is required. Vite only exposes variables that start with `VITE_`
> to your frontend code. Without it, your app will load but won't connect to Supabase.

**Step 6 — Deploy**

Click **Deploy**. Vercel will:
1. Pull your code from GitHub
2. Run `npm install`
3. Run `npm run build`
4. Publish the `dist/` folder to their global CDN

This takes about 30–60 seconds. When it finishes you'll see a confetti screen and a live URL
like `https://leetflow-yourname.vercel.app`. Click **Visit** to open it.

> ✅ Your dashboard is now live on the internet with HTTPS, no extra setup needed.

---

## Part 3 — Update the Chrome extension

Your extension has the dashboard URL hardcoded. Now that it's deployed, update it.

**Step 7 — Update the URL in popup.js**

Open `extension/popup.js` and change the first line:

```js
// Before
const DASHBOARD_URL = "http://localhost:5173";

// After
const DASHBOARD_URL = "https://leetflow-yourname.vercel.app";
```

Replace `leetflow-yourname.vercel.app` with your actual Vercel URL.

**Step 8 — Reload the extension in Chrome**

1. Go to `chrome://extensions/`
2. Find LeetFlow and click the **↺ refresh** icon
3. The Open Dashboard button in the popup now opens your live site

---

## Part 4 — Update Supabase Auth redirect

When you sign in via Google OAuth (if enabled), Supabase redirects back to your app.
You need to tell it your new production URL.

**Step 9 — Add your Vercel URL to Supabase**

1. Go to your Supabase project → **Authentication → URL Configuration**
2. Under **Redirect URLs**, click **Add URL**
3. Add: `https://leetflow-yourname.vercel.app`
4. Click **Save**

> If you're only using email/password login, you can skip this step.

---

## Automatic deploys (free, happens automatically)

From now on, every time you push code to GitHub:

```bash
git add .
git commit -m "your message"
git push
```

Vercel detects the push and redeploys automatically within 60 seconds.
Your live URL stays the same — no manual steps needed.

---

## Troubleshooting

**Build failed — "Could not find package.json"**
→ You forgot to set Root Directory to `dashboard`. Go to Vercel → your project →
Settings → General → Root Directory → change to `dashboard` → Redeploy.

**App loads but shows blank / can't connect to Supabase**
→ Your environment variables are missing or wrong. Go to Vercel → your project →
Settings → Environment Variables → check both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are present with correct values → Redeploy.

**Sign in redirects to localhost after deploying**
→ You haven't added your Vercel URL to Supabase's Redirect URLs (Step 9 above).

**Page refreshes give a 404 (e.g. going directly to /problems)**
→ Your app uses client-side routing. Create a file called `vercel.json` in the
`dashboard/` folder with this content, then push:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## Your deployment checklist

- [ ] Code pushed to GitHub
- [ ] Vercel project created with Root Directory set to `dashboard`
- [ ] `VITE_SUPABASE_URL` environment variable added
- [ ] `VITE_SUPABASE_ANON_KEY` environment variable added
- [ ] First deploy succeeded — live URL works
- [ ] `DASHBOARD_URL` in `extension/popup.js` updated to Vercel URL
- [ ] Extension reloaded in `chrome://extensions/`
- [ ] Supabase redirect URL updated (if using Google OAuth)
