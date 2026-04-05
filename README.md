# Freight Doc Merge Demo Deployment

This folder is a static production build with demo authentication enabled.

## Demo login accounts
- Username: Admin
- Password: Admin@123

- Username: freight_user
- Password: Freight@123

## Vercel deployment
1. Import this repository in Vercel.
2. Framework Preset: Other.
3. Root Directory: this folder (if your repository contains multiple folders).
4. Build Command: leave empty.
5. Output Directory: leave empty (static root).

`vercel.json` is included to ensure unknown routes fall back to the login app entry.

## GitHub Pages deployment
1. Push this folder to your Git repository.
2. In GitHub: Settings -> Pages.
3. Source: Deploy from a branch.
4. Select your deployment branch and folder.

Notes:
- `.nojekyll` is present so assets with underscores are served correctly.
- `404.html` is included so unknown routes redirect to the login entry.

## Important hosting note
This build uses absolute app routing internally. It works best when served from domain root (for example, your custom domain or Vercel project root).
If you deploy to a GitHub Pages project subpath (for example, /repo-name/), some in-app route transitions may not resolve correctly without rebuilding with a subpath base href.
