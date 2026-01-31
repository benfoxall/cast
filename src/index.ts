import { Env, CastSession } from "./session";

export { CastSession };

function generateSessionId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Root path - create new session and redirect to cast page
    if (path === "/") {
      const sessionId = generateSessionId();
      return Response.redirect(`${url.origin}/~${sessionId}`, 302);
    }

    // Cast page (~sessionId)
    if (path.match(/^\/~[a-z0-9]{5}$/)) {
      const sessionId = path.slice(2);
      const id = env.CAST_SESSION.idFromName(sessionId);
      const stub = env.CAST_SESSION.get(id);

      // Initialize session
      const initResponse = await stub.fetch(
        new Request(`${url.origin}/init`, {
          method: "POST",
        }),
      );
      const { casterToken } = (await initResponse.json()) as {
        sessionId: string;
        casterToken: string;
      };

      return new Response(getCastPageHTML(sessionId, url.origin, casterToken), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // View page (-sessionId)
    if (path.match(/^\/\-[a-z0-9]{5}$/)) {
      const sessionId = path.slice(2);
      return new Response(getViewPageHTML(sessionId, url.origin), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // API routes to Durable Object
    if (path.match(/^\/api\/[a-z0-9]{5}\//)) {
      const sessionId = path.split("/")[2];
      const id = env.CAST_SESSION.idFromName(sessionId);
      const stub = env.CAST_SESSION.get(id);

      const apiPath = "/" + path.split("/").slice(3).join("/");
      const apiUrl = new URL(request.url);
      apiUrl.pathname = apiPath;

      return stub.fetch(new Request(apiUrl, request));
    }

    return new Response("Not Found", { status: 404 });
  },
};

function getCastPageHTML(
  sessionId: string,
  origin: string,
  casterToken: string,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cast - ${sessionId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { margin-bottom: 10px; }
    p { margin-bottom: 20px; }
    button {
      font-family: 'Courier New', monospace;
      padding: 10px 20px;
      margin: 10px 0;
      cursor: pointer;
      background: white;
      border: 1px solid black;
    }
    button:hover { background: #f0f0f0; }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .link {
      background: #f0f0f0;
      padding: 10px;
      margin: 20px 0;
      cursor: pointer;
      user-select: all;
    }
    .link:hover { background: #e0e0e0; }
    video {
      width: 100%;
      max-width: 600px;
      margin: 20px 0;
      border: 1px solid black;
    }
    #status {
      margin: 20px 0;
      padding: 10px;
      background: #f0f0f0;
    }
  </style>
</head>
<body>
  <h1>cast</h1>
  <p>share your screen with others</p>
  
  <div class="link" onclick="copyLink()" title="Click to copy">
    ${origin}/-${sessionId}
  </div>

  <button id="addScreenBtn" onclick="addScreen()">Add screen</button>
  
  <div id="status">Initializing...</div>
  
  <video id="localPreview" autoplay muted playsinline></video>

  <script>
    const SESSION_ID = "${sessionId}";
    const ORIGIN = "${origin}";
    const CASTER_TOKEN = "${casterToken}";
    
    let pc = null;
    let callsSessionId = null;
    let localStream = null;
    
    function copyLink() {
      navigator.clipboard.writeText(ORIGIN + "/-" + SESSION_ID);
      document.querySelector('.link').textContent = "Copied!";
      setTimeout(() => {
        document.querySelector('.link').innerHTML = ORIGIN + "/-" + SESSION_ID;
      }, 1000);
    }

    async function initCallsSession() {
      try {
        const response = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/calls-session\`, {
          method: "POST",
          headers: {
            "Authorization": \`Bearer \${CASTER_TOKEN}\`
          }
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error("Failed to create Calls session: " + error);
        }
        
        const data = await response.json();
        callsSessionId = data.sessionId;
        
        // Create RTCPeerConnection
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle"
        });
        
        // Debug connection state
        pc.onconnectionstatechange = () => {
          console.log("Caster connection state:", pc.connectionState);
        };
        
        pc.oniceconnectionstatechange = () => {
          console.log("Caster ICE connection state:", pc.iceConnectionState);
        };
        
        updateStatus("Ready to add screen");
        document.getElementById("addScreenBtn").disabled = false;
      } catch (error) {
        console.error("Error initializing Calls:", error);
        updateStatus("Error: " + error.message);
      }
    }

    async function addScreen() {
      try {
        if (!callsSessionId) {
          await initCallsSession();
        }
        
        updateStatus("Requesting screen access...");
        
        // Get display media
        localStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true
        });
        
        // Show local preview
        const preview = document.getElementById("localPreview");
        preview.srcObject = localStream;
        
        // Add tracks to peer connection
        const videoTrack = localStream.getVideoTracks()[0];
        
        if (videoTrack) {
          const sender = pc.addTrack(videoTrack, localStream);
          
          const audioTrack = localStream.getAudioTracks()[0];
          if (audioTrack) {
            pc.addTrack(audioTrack, localStream);
          }
          
          updateStatus("Creating offer...");
          
          // Create offer with tracks
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          console.log("Created offer with tracks");
          
          // Get the mid from the transceiver
          const transceiver = pc.getTransceivers().find(t => t.sender === sender);
          const mid = transceiver?.mid;
          
          updateStatus("Sending offer to Calls...");
          
          // Send offer to Calls via tracks/new and get answer back
          const trackResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/add-track\`, {
            method: "POST",
            headers: {
              "Authorization": \`Bearer \${CASTER_TOKEN}\`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              callsSessionId: callsSessionId,
              trackName: videoTrack.id,
              kind: "video",
              mid: mid,
              sessionDescription: {
                type: offer.type,
                sdp: offer.sdp
              }
            })
          });
          
          if (!trackResponse.ok) {
            const error = await trackResponse.text();
            throw new Error("Failed to add track: " + error);
          }
          
          const trackData = await trackResponse.json();
          console.log("Track response from Calls:", trackData);
          
          updateStatus("Setting answer from Calls...");
          
          // Set the answer from Calls
          if (trackData.sessionDescription && trackData.sessionDescription.type === 'answer') {
            await pc.setRemoteDescription(trackData.sessionDescription);
            console.log("Answer set, connection established");
          }
          
          // Monitor if we're actually sending media
          setTimeout(async () => {
            const stats = await pc.getStats();
            stats.forEach(stat => {
              if (stat.type === 'outbound-rtp' && stat.mediaType === 'video') {
                console.log("Video outbound stats:", {
                  bytesSent: stat.bytesSent,
                  packetsSent: stat.packetsSent,
                  framesEncoded: stat.framesEncoded
                });
              }
            });
          }, 2000);
          
          // Check Calls session state
          const stateResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/calls-state\`, {
            headers: { "Authorization": \`Bearer \${CASTER_TOKEN}\` }
          });
          const callsState = await stateResponse.json();
          console.log("Cloudflare Calls session state (caster):", callsState);
        }
        
        // Handle stream end
        videoTrack.addEventListener("ended", () => {
          updateStatus("Screen sharing stopped");
          preview.srcObject = null;
        });
        
        updateStatus("Casting screen");
        document.getElementById("addScreenBtn").textContent = "Switch screen";
        
      } catch (error) {
        console.error("Error adding screen:", error);
        updateStatus("Error: " + error.message);
      }
    }

    function updateStatus(text) {
      document.getElementById("status").textContent = text;
    }

    // Initialize on load
    initCallsSession();
  </script>
</body>
</html>`;
}

function getViewPageHTML(sessionId: string, origin: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>View - ${sessionId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: black;
      overflow: hidden;
      cursor: pointer;
    }
    video {
      width: 100vw;
      height: 100vh;
      object-fit: contain;
    }
    #waiting {
      color: white;
      font-family: 'Courier New', monospace;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="waiting">Waiting for stream...</div>
  <video id="remoteVideo" autoplay muted playsinline style="display: none;"></video>

  <script>
    const SESSION_ID = "${sessionId}";
    const ORIGIN = "${origin}";
    
    let pc = null;
    let callsSessionId = null;
    let trackName = null;
    
    async function checkSession() {
      try {
        const response = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/info\`);
        const data = await response.json();
        
        if (data.ready && data.callsSessionId && data.trackName) {
          callsSessionId = data.callsSessionId;
          trackName = data.trackName;
          await connectToStream();
        } else {
          setTimeout(checkSession, 2000);
        }
      } catch (error) {
        console.error("Error checking session:", error);
        setTimeout(checkSession, 2000);
      }
    }

    async function connectToStream() {
      try {
        // Create peer connection first
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle"
        });
        
        // Debug connection state
        pc.onconnectionstatechange = () => {
          console.log("Connection state:", pc.connectionState);
        };
        
        pc.oniceconnectionstatechange = () => {
          console.log("ICE connection state:", pc.iceConnectionState);
        };
        
        // Handle incoming tracks
        pc.ontrack = (event) => {
          console.log("Received track:", event.track.kind);
          const video = document.getElementById("remoteVideo");
          
          if (event.streams && event.streams[0]) {
            video.srcObject = event.streams[0];
          } else {
            const stream = new MediaStream([event.track]);
            video.srcObject = stream;
          }
          
          document.getElementById("waiting").style.display = "none";
          video.style.display = "block";
        };
        
        // Create new session for viewing via proxy
        const newSessionResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/new-session\`, {
          method: "POST"
        });
        
        if (!newSessionResponse.ok) throw new Error("Failed to create viewer session");
        
        const newSessionData = await newSessionResponse.json();
        const viewerSessionId = newSessionData.sessionId;
        
        // Retry pulling tracks if not found (caster might not be sending yet)
        let retries = 0;
        const maxRetries = 10;
        let pullData;
        
        while (retries < maxRetries) {
          // Pull tracks from caster session
          const pullResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/pull-tracks\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              viewerSessionId,
              trackName: trackName
            })
          });
          
          if (!pullResponse.ok) throw new Error("Failed to pull tracks");
          
          pullData = await pullResponse.json();
          console.log("Pull tracks response (attempt " + (retries + 1) + "):", pullData);
          
          // Check if tracks have errors
          const hasError = pullData.tracks && pullData.tracks.some(t => t.errorCode);
          
          if (hasError) {
            console.log("Track not ready yet, retrying in 1 second...");
            retries++;
            if (retries < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            } else {
              throw new Error("Track not found after " + maxRetries + " attempts");
            }
          }
          
          break;
        }
        
        console.log("Tracks in response:", pullData.tracks);
        
        // Log each track in detail
        if (pullData.tracks && pullData.tracks.length > 0) {
          pullData.tracks.forEach((track, index) => {
            console.log(\`Track \${index}:\`, track);
          });
        }
        
        console.log("Remote SDP offer:", pullData.sessionDescription);
        
        // The pull response includes the offer with tracks
        if (pullData.sessionDescription && pullData.sessionDescription.type) {
          console.log("Setting remote description...");
          await pc.setRemoteDescription(pullData.sessionDescription);
          
          console.log("Transceivers after setRemoteDescription:", pc.getTransceivers().map(t => {
            return {
              mid: t.mid,
              direction: t.direction,
              currentDirection: t.currentDirection,
              receiver: {
                track: t.receiver.track ? {
                  id: t.receiver.track.id,
                  kind: t.receiver.track.kind,
                  readyState: t.receiver.track.readyState
                } : null
              }
            };
          }));
          
          // Create and set answer
          const answer = await pc.createAnswer();
          console.log("Created answer:", answer);
          await pc.setLocalDescription(answer);
          
          console.log("Sending answer to Calls via viewer-renegotiate...");
          
          // Send answer back
          const renegResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/viewer-renegotiate\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              viewerSessionId,
              sessionDescription: {
                type: answer.type,
                sdp: answer.sdp
              }
            })
          });
          
          if (!renegResponse.ok) {
            const errorText = await renegResponse.text();
            console.error("Viewer renegotiate failed:", errorText);
            throw new Error("Failed to send answer: " + errorText);
          }
          
          const renegData = await renegResponse.json();
          console.log("Viewer renegotiate response:", renegData);
          
          // Check viewer Calls session state
          const viewerStateResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/viewer-calls-state\`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewerSessionId })
          });
          const viewerCallsState = await viewerStateResponse.json();
          console.log("Cloudflare Calls session state (viewer):", viewerCallsState);
          
          document.getElementById("waiting").textContent = "Waiting for stream...";
        } else {
          throw new Error("No session description from pull-tracks");
        }
        
      } catch (error) {
        console.error("Error connecting to stream:", error);
        document.getElementById("waiting").textContent = "Error connecting: " + error.message;
      }
    }

    // Click to fullscreen
    document.body.addEventListener("click", () => {
      const video = document.getElementById("remoteVideo");
      if (video.requestFullscreen) {
        video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      }
    });

    // Start checking for session
    checkSession();
  </script>
</body>
</html>`;
}
