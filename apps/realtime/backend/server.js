const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { resolveTurn } = require("./resolver");

loadLocalEnv();

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";
const REALTIME_INSTRUCTIONS = [
  "You are a Neste customer service specialist for generic gas station mobile app scenarios.",
  "Speak concise, calm, natural Finnish.",
  "Only verbalize the exact backend-approved Finnish response provided in each turn.",
  "Do not invent company policy, app features, next steps, or facts.",
].join(" ");

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/resolve-turn") {
    const body = await readJsonBody(request);
    const decision = resolveTurn(body?.transcript);

    sendJson(response, 200, decision);
    return;
  }

  if (request.method === "POST" && request.url === "/realtime-session") {
    const sdp = await readTextBody(request);

    if (!process.env.OPENAI_API_KEY) {
      sendJson(response, 500, { error: "OPENAI_API_KEY is not configured" });
      return;
    }

    if (!sdp) {
      sendJson(response, 400, { error: "Missing SDP offer body" });
      return;
    }

    try {
      const answer = await createRealtimeSession(sdp);
      sendText(response, 200, answer, "application/sdp");
    } catch (error) {
      console.error("Realtime session error:", error);
      sendJson(response, 500, { error: "Failed to create realtime session" });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Realtime resolver listening at http://${HOST}:${PORT}`);
  console.log("POST /resolve-turn with JSON: { \"transcript\": \"...\" }");
  console.log("POST /realtime-session with an SDP offer to initialize Realtime audio");
});

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": `${contentType}; charset=utf-8`,
  });
  response.end(payload);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
    });

    request.on("end", () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        resolve({});
      }
    });

    request.on("error", () => {
      resolve({});
    });
  });
}

function readTextBody(request) {
  return new Promise((resolve) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
    });

    request.on("end", () => {
      resolve(rawBody.trim());
    });

    request.on("error", () => {
      resolve("");
    });
  });
}

async function createRealtimeSession(sdp) {
  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: REALTIME_INSTRUCTIONS,
      audio: {
        output: {
          voice: REALTIME_VOICE,
        },
      },
    })
  );

  const realtimeResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  const text = await realtimeResponse.text();

  if (!realtimeResponse.ok) {
    throw new Error(text || `OpenAI Realtime returned ${realtimeResponse.status}`);
  }

  return text;
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
