# Implementation Notes

## Overview

This is a minimal screen sharing application built on Cloudflare Workers infrastructure. The architecture follows a simple pattern where the Worker handles routing, a Durable Object manages session state, and Cloudflare Calls provides the WebRTC SFU (Selective Forwarding Unit) for media streaming.

## Key Design Decisions

### 1. Session Management

- **Session IDs**: 5-character alphanumeric strings (e.g., `abc12`)
  - Provides ~60 million possible combinations
  - Easy to share verbally or via text
  - Generated using `generateSessionId()` in `index.ts`

- **Durable Objects**: Each session gets its own Durable Object instance
  - Identified by the session ID using `idFromName()`
  - Persists across page reloads
  - Stores session metadata (caster token, Calls session ID, track name)

### 2. Authentication

- **Caster**: Uses a UUID token stored in the Durable Object
  - Token is returned when session is initialized
  - Required for all mutation operations (creating Calls session, adding tracks)
  - Stored in JavaScript variable (not in cookies for simplicity)

- **Viewers**: No authentication required
  - Can only pull tracks, not modify anything
  - Relies on session ID being "secret"

### 3. Cloudflare Calls Integration

The app proxies all Calls API requests through the Durable Object for two reasons:

1. **Security**: Keeps the `CALLS_APP_SECRET` server-side only
2. **Simplicity**: Viewers don't need to know the App ID

#### API Flow

**Caster:**

1. `/api/{sessionId}/calls-session` - Creates new Calls session
2. `/api/{sessionId}/add-track` - Registers track with Calls
3. `/api/{sessionId}/renegotiate` - Updates SDP after adding tracks

**Viewer:**

1. `/api/{sessionId}/info` - Checks if session is ready
2. `/api/{sessionId}/new-session` - Creates viewer Calls session
3. `/api/{sessionId}/pull-tracks` - Pulls tracks from caster session
4. `/api/{sessionId}/viewer-renegotiate` - Completes WebRTC negotiation

### 4. WebRTC Flow

**Caster Side:**

```
1. User clicks "Add screen"
2. getDisplayMedia() prompts for screen selection
3. Create RTCPeerConnection
4. Get offer from Calls (/sessions/new)
5. Add local tracks to peer connection
6. Create new offer (with tracks)
7. Send to Calls (/renegotiate)
8. Receive answer and set remote description
```

**Viewer Side:**

```
1. Poll /info endpoint until session ready
2. Create new Calls session for viewing
3. Create RTCPeerConnection
4. Pull tracks from caster's session (trackName: "*")
5. Get updated offer from Calls
6. Create answer
7. Send answer to Calls
8. Receive tracks via ontrack event
```

### 5. URL Scheme

- `/` - Landing page (redirects to new session)
- `/~{id}` - Cast page (tilde ~ represents "home" for caster)
- `/-{id}` - View page (minus - represents "reading" mode)

The distinct prefixes make it impossible to confuse URLs and provide a visual distinction.

### 6. UI/UX Choices

**Cast Page:**

- Shows viewer link prominently (click to copy)
- Simple "Add screen" button
- Local preview of shared screen
- Status messages for feedback

**View Page:**

- Zero UI (completely black background)
- Video fills viewport with `object-fit: contain`
- Click anywhere to enter fullscreen
- "Waiting for stream..." message when not connected

**Styling:**

- Monospace font (Courier New) for technical feel
- Black and white color scheme
- Minimal borders and padding
- No framework dependencies (vanilla HTML/CSS/JS)

## File Structure

```
cast/
├── src/
│   ├── index.ts          # Worker entry point, routing, HTML generation
│   └── session.ts        # Durable Object for session management
├── wrangler.jsonc        # Worker configuration
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
├── README.md             # Quick start guide
├── SETUP.md              # Detailed setup instructions
└── .env.example          # Environment variable template
```

## Potential Improvements

### Features

- [ ] Support multiple concurrent streams per session
- [ ] Add audio mute control
- [ ] Show viewer count to caster
- [ ] Session expiration (auto-cleanup after N hours)
- [ ] Recording capability
- [ ] Chat or annotation features

### Technical

- [ ] Use WebSocket for real-time session state updates
- [ ] Implement proper reconnection logic for dropped connections
- [ ] Add TURN server configuration for better NAT traversal
- [ ] Use WebRTC Data Channels for control messages
- [ ] Add analytics/monitoring

### Security

- [ ] Rate limiting on session creation
- [ ] Require password for sensitive sessions
- [ ] Add session expiry
- [ ] CORS configuration for production
- [ ] Content Security Policy headers

## Known Limitations

1. **Browser Support**: Requires modern browser with `getDisplayMedia` support (Chrome, Firefox, Safari 13+, Edge)

2. **Network**: WebRTC requires UDP connectivity. May not work behind restrictive firewalls without TURN.

3. **Screen Sharing**: macOS requires Screen Recording permission in System Preferences > Security & Privacy.

4. **Session Persistence**: Sessions persist in Durable Object but tracks timeout after 30s of inactivity (Calls limitation).

5. **Concurrent Viewers**: While technically unlimited, practical limit depends on bandwidth and Calls quotas.

## Cloudflare Calls API Behavior

- Sessions are identified by unique IDs
- Tracks belong to sessions
- Tracks can be "local" (pushed) or "remote" (pulled)
- Using trackName: "\*" pulls all tracks from a session
- Renegotiation is required when adding/removing tracks
- WebRTC negotiation follows offer/answer pattern

## Testing Recommendations

1. **Local Testing**: Use `wrangler dev --remote` to test with real Durable Objects
2. **Multiple Browsers**: Test caster in Chrome, viewer in Firefox
3. **Network Simulation**: Use Chrome DevTools to simulate slow 3G
4. **Mobile**: Test on iPhone Safari and Android Chrome
5. **Different Screens**: Test with multiple monitors, windows, browser tabs

## Deployment Checklist

Before deploying to production:

- [ ] Update `CALLS_APP_ID` and `CALLS_APP_SECRET` in wrangler.jsonc
- [ ] Test locally with `npm run dev`
- [ ] Deploy with `npm run deploy`
- [ ] Configure custom domain in Cloudflare dashboard
- [ ] Test with actual screen sharing
- [ ] Verify multiple viewers can connect
- [ ] Check Worker logs for errors
- [ ] Monitor Calls usage in dashboard

## Resources

- [Cloudflare Calls Documentation](https://developers.cloudflare.com/calls/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [WebRTC API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [getDisplayMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
