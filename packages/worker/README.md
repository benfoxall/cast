# cast

A minimal screen sharing tool for meetings. Share your screen with others via a simple URL.

## Quick Start

```bash
# Install dependencies
npm install

# Add your Cloudflare Calls credentials to .dev.vars
# See SETUP.md for detailed instructions

# Run locally
npm run dev

# Deploy
npm run deploy
```

Visit the deployed URL and you'll be redirected to a cast page. Click "Add screen" to start sharing!

## Features

- Auto-generated session URLs (e.g., `cast.benjaminbenben.com/~abcde`)
- Viewer URLs (e.g., `cast.benjaminbenben.com/-abcde`)
- Screen sharing using `getDisplayMedia`
- Robust reconnection support
- Built on Cloudflare Workers + Durable Objects + Calls

## How it works

### Architecture

- **Worker**: Routes requests and serves HTML
- **Durable Object**: Manages session state and coordinates caster/viewer connections
- **Cloudflare Calls**: Handles WebRTC media streaming (SFU)

### Flow

1. Visit root (`/`) → redirects to `/~{sessionId}` (cast page)
2. Cast page initializes a Durable Object session
3. Caster clicks "Add screen" → uses `getDisplayMedia` to capture screen
4. Screen is pushed to Cloudflare Calls as a WebRTC track
5. Viewers visit `/-{sessionId}` → pull the track from Calls
6. Video is displayed full-window, click for fullscreen

### URLs

- `/` - Creates new session, redirects to cast page
- `/~{sessionId}` - Cast page (for the person sharing)
- `/-{sessionId}` - View page (for viewers)

## Documentation

- [SETUP.md](SETUP.md) - Detailed setup instructions
- [Cloudflare Calls Docs](https://developers.cloudflare.com/calls/)
- [Durable Objects Docs](https://developers.cloudflare.com/durable-objects/)

## Tech Stack

- Cloudflare Workers
- Durable Objects
- Cloudflare Calls (WebRTC SFU)
- TypeScript

## Notes

- Cookie-based auth protects the caster session
- Viewers need no authentication
- Sessions persist across page reloads
- Only one active stream per session (but can switch)
- Minimal UI with monospace font

## License

See LICENSE file.
