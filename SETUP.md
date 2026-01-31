# Setup Instructions

## Prerequisites

- Node.js 18+ installed
- A Cloudflare account
- Wrangler CLI (will be installed via npm)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Get Cloudflare Calls Credentials

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Calls** (or **Realtime** in the sidebar)
3. Create a new App if you don't have one
4. Copy your **App ID** and **App Secret**

## Step 3: Configure Environment

Edit `wrangler.jsonc` and replace the placeholder values:

```jsonc
{
  // ... other config
  "vars": {
    "CALLS_APP_ID": "your-actual-app-id-here",
    "CALLS_APP_SECRET": "your-actual-app-secret-here",
  },
}
```

**Important:** Do NOT commit your secrets to version control. For production, use `wrangler secret` instead:

```bash
wrangler secret put CALLS_APP_SECRET
```

## Step 4: Test Locally

```bash
npm run dev
```

Open http://localhost:8787 in your browser. You should be redirected to a cast page with a 5-character session ID.

## Step 5: Deploy

```bash
npm run deploy
```

After deployment, Wrangler will output your Worker URL (e.g., `cast.your-account.workers.dev`).

## Step 6: Configure Custom Domain (Optional)

To use a custom domain like `cast.benjaminbenben.com`:

1. Go to your Worker in the Cloudflare Dashboard
2. Navigate to **Settings** > **Domains & Routes**
3. Click **Add Custom Domain**
4. Enter your domain (e.g., `cast.benjaminbenben.com`)
5. Cloudflare will automatically configure DNS

## Testing the Application

### As Caster:

1. Visit your deployed URL (or localhost:8787)
2. You'll be redirected to `/~{sessionId}` (e.g., `/~abc12`)
3. Click "Add screen" and select which screen/window to share
4. Copy the viewer link displayed on the page

### As Viewer:

1. Visit the viewer URL: `/-{sessionId}` (e.g., `/-abc12`)
2. The stream will appear automatically when the caster starts sharing
3. Click the video to go fullscreen

## Troubleshooting

### "Failed to create Calls session"

- Verify your `CALLS_APP_ID` and `CALLS_APP_SECRET` are correct
- Check you have Calls enabled on your Cloudflare account
- Look at Worker logs: `wrangler tail` or check the Dashboard

### Video doesn't appear for viewers

- Make sure the caster has clicked "Add screen" and selected a source
- Check browser console for errors on both caster and viewer pages
- Verify network connectivity (WebRTC requires UDP)

### Permission denied for screen sharing

- The browser needs HTTPS or localhost to use `getDisplayMedia`
- Grant screen recording permissions in your OS settings if prompted

## Architecture Overview

```
┌─────────────┐
│   Browser   │ (Caster)
│  /~abc12    │
└──────┬──────┘
       │ getDisplayMedia
       │
       ├──► Cloudflare Worker
       │    ├─► Durable Object (Session State)
       │    └─► Calls API (WebRTC SFU)
       │
┌──────▼──────┐
│   Browser   │ (Viewer)
│  /-abc12    │
└─────────────┘
```

1. **Worker**: Entry point, handles routing
2. **Durable Object**: Stores session state, coordinates connections
3. **Calls API**: Cloudflare's WebRTC infrastructure, handles media streaming

## Development Tips

- Use `wrangler dev --remote` to test with actual Durable Objects
- Check `wrangler tail` for live logs
- Browser DevTools > Console shows client-side errors
- Keep sessions short for testing (they auto-expire)

## Production Checklist

- [ ] Move secrets to `wrangler secret` instead of `wrangler.jsonc`
- [ ] Set up custom domain
- [ ] Configure CORS if needed
- [ ] Set up monitoring/alerts
- [ ] Test on multiple browsers (Chrome, Firefox, Safari)
- [ ] Test network conditions (mobile, poor connectivity)

## Limits

Cloudflare Calls free tier includes:

- 1,000 GB/month of egress bandwidth (viewer traffic)
- Unlimited ingress bandwidth (caster traffic)
- No limit on number of sessions or viewers

See [Calls Pricing](https://developers.cloudflare.com/calls/pricing/) for details.
