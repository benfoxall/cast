import { DurableObject } from "cloudflare:workers";

export interface Env {
  CAST_SESSION: DurableObjectNamespace;
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
}

interface SessionData {
  sessionId: string;
  createdAt: number;
  casterToken?: string;
  callsSessionId?: string;
  trackName?: string;
}

export class CastSession extends DurableObject<Env> {
  private sessions: Map<WebSocket, { role: "caster" | "viewer" }> = new Map();
  private sessionData: SessionData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Restore session on restart
    this.ctx.blockConcurrencyWhile(async () => {
      this.sessionData = await this.ctx.storage.get<SessionData>("sessionData");
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for real-time communication
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const role =
        (url.searchParams.get("role") as "caster" | "viewer") || "viewer";

      this.ctx.acceptWebSocket(server);
      this.sessions.set(server, { role });

      // Send current session data to new connection
      if (this.sessionData) {
        server.send(
          JSON.stringify({
            type: "session-data",
            data: {
              sessionId: this.sessionData.sessionId,
              callsSessionId: this.sessionData.callsSessionId,
              trackName: this.sessionData.trackName,
            },
          }),
        );
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Initialize session
    if (request.method === "POST" && url.pathname.endsWith("/init")) {
      if (!this.sessionData) {
        const sessionId = this.ctx.id.toString().slice(0, 8);
        const casterToken = crypto.randomUUID();

        this.sessionData = {
          sessionId,
          createdAt: Date.now(),
          casterToken,
        };

        await this.ctx.storage.put("sessionData", this.sessionData);
      }

      return Response.json({
        sessionId: this.sessionData.sessionId,
        casterToken: this.sessionData.casterToken,
      });
    }

    // Create Cloudflare Calls session
    if (request.method === "POST" && url.pathname.endsWith("/calls-session")) {
      const auth = request.headers.get("Authorization");
      if (
        !this.sessionData ||
        auth !== `Bearer ${this.sessionData.casterToken}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      // Create a new Calls session
      const callsResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/new`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!callsResponse.ok) {
        return new Response("Failed to create Calls session", { status: 500 });
      }

      const callsData = (await callsResponse.json()) as any;

      this.sessionData.callsSessionId = callsData.sessionId;
      await this.ctx.storage.put("sessionData", this.sessionData);

      // Broadcast to viewers
      this.broadcast({
        type: "calls-session-ready",
        sessionId: callsData.sessionId,
      });

      return Response.json({
        sessionId: callsData.sessionId,
        sessionDescription: callsData.sessionDescription,
      });
    }

    // Renegotiate session
    if (request.method === "POST" && url.pathname.endsWith("/renegotiate")) {
      const auth = request.headers.get("Authorization");
      if (
        !this.sessionData ||
        auth !== `Bearer ${this.sessionData.casterToken}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const { callsSessionId, sessionDescription } = (await request.json()) as {
        callsSessionId: string;
        sessionDescription: RTCSessionDescriptionInit;
      };

      const renegResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/${callsSessionId}/renegotiate`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionDescription }),
        },
      );

      if (!renegResponse.ok) {
        return new Response("Failed to renegotiate", { status: 500 });
      }

      return Response.json(await renegResponse.json());
    }

    // Add track to session
    if (request.method === "POST" && url.pathname.endsWith("/add-track")) {
      const auth = request.headers.get("Authorization");
      if (
        !this.sessionData ||
        auth !== `Bearer ${this.sessionData.casterToken}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const { callsSessionId, trackName } = (await request.json()) as {
        callsSessionId: string;
        trackName: string;
      };

      const trackResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/${callsSessionId}/tracks/new`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tracks: [
              {
                location: "local",
                trackName: trackName,
              },
            ],
          }),
        },
      );

      if (!trackResponse.ok) {
        return new Response("Failed to add track", { status: 500 });
      }

      this.sessionData.trackName = trackName;
      await this.ctx.storage.put("sessionData", this.sessionData);

      // Broadcast to viewers
      this.broadcast({
        type: "track-added",
        trackName,
      });

      return Response.json({ success: true });
    }

    // Proxy new session request
    if (request.method === "POST" && url.pathname.endsWith("/new-session")) {
      const callsResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/new`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!callsResponse.ok) {
        return new Response("Failed to create new session", { status: 500 });
      }

      return Response.json(await callsResponse.json());
    }

    // Proxy pull tracks request
    if (request.method === "POST" && url.pathname.endsWith("/pull-tracks")) {
      const { viewerSessionId } = (await request.json()) as {
        viewerSessionId: string;
      };

      if (!this.sessionData || !this.sessionData.callsSessionId) {
        return new Response("No active session", { status: 404 });
      }

      const pullResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/${viewerSessionId}/tracks/new`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tracks: [
              {
                location: "remote",
                sessionId: this.sessionData.callsSessionId,
                trackName: "*",
              },
            ],
          }),
        },
      );

      if (!pullResponse.ok) {
        return new Response("Failed to pull tracks", { status: 500 });
      }

      return Response.json(await pullResponse.json());
    }

    // Proxy viewer renegotiate
    if (
      request.method === "POST" &&
      url.pathname.endsWith("/viewer-renegotiate")
    ) {
      const { viewerSessionId, sessionDescription } =
        (await request.json()) as {
          viewerSessionId: string;
          sessionDescription?: RTCSessionDescriptionInit;
        };

      const body = sessionDescription
        ? JSON.stringify({ sessionDescription })
        : undefined;

      const renegResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/${viewerSessionId}/renegotiate`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body,
        },
      );

      if (!renegResponse.ok) {
        return new Response("Failed to renegotiate", { status: 500 });
      }

      return Response.json(await renegResponse.json());
    }

    // Get session info (for viewers)
    if (request.method === "GET" && url.pathname.endsWith("/info")) {
      if (!this.sessionData || !this.sessionData.callsSessionId) {
        return Response.json({ ready: false });
      }

      return Response.json({
        ready: true,
        callsSessionId: this.sessionData.callsSessionId,
        trackName: this.sessionData.trackName,
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);
      const session = this.sessions.get(ws);

      if (!session) return;

      // Forward messages between caster and viewers
      if (data.type === "signal") {
        // Broadcast signaling data
        for (const [socket, socketSession] of this.sessions) {
          if (socket !== ws && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(data));
          }
        }
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    this.sessions.delete(ws);
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
    this.sessions.delete(ws);
  }

  private broadcast(message: any) {
    const json = JSON.stringify(message);
    for (const [socket] of this.sessions) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(json);
      }
    }
  }
}
