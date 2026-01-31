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
        
        // Create RTCPeerConnection with Calls session
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle"
        });
        
        // Set remote description from Calls
        await pc.setRemoteDescription(data.sessionDescription);
        
        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        // Renegotiate with answer
        const renegResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/renegotiate\`, {
          method: "POST",
          headers: {
            "Authorization": \`Bearer \${CASTER_TOKEN}\`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            callsSessionId: callsSessionId,
            sessionDescription: {
              type: answer.type,
              sdp: answer.sdp
            }
          })
        });
        
        if (!renegResponse.ok) throw new Error("Failed to renegotiate");
        
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
          pc.addTrack(videoTrack, localStream);
          
          const audioTrack = localStream.getAudioTracks()[0];
          if (audioTrack) {
            pc.addTrack(audioTrack, localStream);
          }
          
          updateStatus("Adding track to Calls...");
          
          // Add track through session endpoint
          const trackResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/add-track\`, {
            method: "POST",
            headers: {
              "Authorization": \`Bearer \${CASTER_TOKEN}\`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              callsSessionId: callsSessionId,
              trackName: videoTrack.id
            })
          });
          
          if (!trackResponse.ok) {
            const error = await trackResponse.text();
            throw new Error("Failed to add track: " + error);
          }
          
          // Renegotiate with new tracks
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          const renegResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/renegotiate\`, {
            method: "POST",
            headers: {
              "Authorization": \`Bearer \${CASTER_TOKEN}\`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              callsSessionId: callsSessionId,
              sessionDescription: {
                type: offer.type,
                sdp: offer.sdp
              }
            })
          });
          
          if (!renegResponse.ok) throw new Error("Failed to renegotiate");
          
          const renegData = await renegResponse.json();
          if (renegData.sessionDescription) {
            await pc.setRemoteDescription(renegData.sessionDescription);
            
            // Create and send final answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/renegotiate\`, {
              method: "POST",
              headers: {
                "Authorization": \`Bearer \${CASTER_TOKEN}\`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                callsSessionId: callsSessionId,
                sessionDescription: {
                  type: answer.type,
                  sdp: answer.sdp
                }
              })
            });
          }
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
    updateStatus("Ready");
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
  <video id="remoteVideo" autoplay playsinline style="display: none;"></video>

  <script>
    const SESSION_ID = "${sessionId}";
    const ORIGIN = "${origin}";
    
    let pc = null;
    let callsSessionId = null;
    
    async function checkSession() {
      try {
        const response = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/info\`);
        const data = await response.json();
        
        if (data.ready && data.callsSessionId) {
          callsSessionId = data.callsSessionId;
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
        // Create new session for viewing via proxy
        const newSessionResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/new-session\`, {
          method: "POST"
        });
        
        if (!newSessionResponse.ok) throw new Error("Failed to create viewer session");
        
        const newSessionData = await newSessionResponse.json();
        const viewerSessionId = newSessionData.sessionId;
        
        // Create peer connection
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle"
        });
        
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
        
        // Set remote description
        await pc.setRemoteDescription(newSessionData.sessionDescription);
        
        // Pull tracks from caster session via proxy
        const pullResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/pull-tracks\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerSessionId })
        });
        
        if (!pullResponse.ok) throw new Error("Failed to pull tracks");
        
        // Renegotiate via proxy
        const renegotiateResponse = await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/viewer-renegotiate\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerSessionId })
        });
        
        if (!renegotiateResponse.ok) throw new Error("Failed to renegotiate");
        
        const renegotiateData = await renegotiateResponse.json();
        await pc.setRemoteDescription(renegotiateData.sessionDescription);
        
        // Create and set answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        await fetch(\`\${ORIGIN}/api/\${SESSION_ID}/viewer-renegotiate\`, {
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
