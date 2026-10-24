const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_SIZE = 64 * 1024 * 1024;
const CORS_ORIGIN = process.env.CORS_ORIGIN;
let game = null;
const clients = new Set();

function getLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return "localhost";
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(CORS_ORIGIN ? {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    } : {}),
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(new Error("Request is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function publicGame(view, playerId) {
  if (!game) return null;
  const playerView = view === "player";
  const round = game.roundIndex >= 0 ? game.roundIndex : null;
  return {
    status: game.status,
    participants: game.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      adultImage: participant.adultImage,
      ...(playerView ? {} : { babyImage: participant.babyImage }),
    })),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
    })),
    roundIndex: game.roundIndex,
    roundNumber: round === null ? null : round + 1,
    totalRounds: game.participants.length,
    endsAt: game.endsAt,
    answeredCount: round === null ? 0 : Object.keys(game.answers[round] || {}).length,
    playerAnswer: playerId && round !== null
      ? game.answers[round]?.[playerId] || null
      : null,
    roundResult: round !== null && (game.status === "scores" || game.status === "completed")
      ? {
          name: game.participants[round].name,
          adultImage: game.participants[round].adultImage,
          correctPlayers: Object.values(game.answers[round] || {})
            .filter((answer) => answer.correct)
            .map((answer) => game.players.find((player) => player.id === answer.playerId)?.name)
            .filter(Boolean),
        }
      : null,
    results: game.status === "completed"
      ? game.participants.map((participant, index) => ({
          name: participant.name,
          babyImage: playerView ? undefined : participant.babyImage,
          correctPlayers: Object.values(game.answers[index] || {})
            .filter((answer) => answer.correct)
            .map((answer) => game.players.find((player) => player.id === answer.playerId)?.name)
            .filter(Boolean),
        }))
      : null,
  };
}

function sendUpdate() {
  for (const response of clients) {
    const view = response.view;
    response.write(`data: ${JSON.stringify(publicGame(view, response.playerId))}\n\n`);
  }
}

function finishRound() {
  if (!game || game.status !== "playing") return;
  game.status = "scores";
  game.endsAt = null;
  sendUpdate();
}

setInterval(() => {
  if (game?.status === "playing" && Date.now() >= game.endsAt) {
    finishRound();
  }
}, 250);

function serveFile(response, filename, contentType) {
  fs.readFile(path.join(PUBLIC_DIR, filename), (error, contents) => {
    if (error) {
      json(response, 404, { error: "Page not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const view = url.searchParams.get("view") === "player" ? "player" : "quizmaster";
  const playerId = url.searchParams.get("playerId");

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    json(response, 204, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    json(response, 200, { game: publicGame(view, playerId) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/join-url") {
    const joinUrl = process.env.PLAYER_URL || `http://${getLanAddress()}:${PORT}/play`;
    try {
      const playerUrl = new URL(joinUrl);
      playerUrl.searchParams.set("view", "player");
      const finalJoinUrl = playerUrl.toString();
      json(response, 200, { url: finalJoinUrl, qr: await QRCode.toDataURL(finalJoinUrl, { margin: 1, width: 280 }) });
    } catch (error) {
      json(response, 500, { error: `Could not create QR code: ${error.message}` });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(CORS_ORIGIN ? {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        Vary: "Origin",
      } : {}),
    });
    response.view = view;
    response.playerId = playerId;
    response.write(`data: ${JSON.stringify(publicGame(view, playerId))}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/game") {
    try {
      const body = await readJson(request);
      if (!Array.isArray(body.participants) || body.participants.length < 2) {
        json(response, 400, { error: "Add at least two participants." });
        return;
      }
      const participants = body.participants.map((participant) => ({
        id: crypto.randomUUID(),
        name: String(participant.name || "").trim(),
        babyImage: participant.babyImage,
        adultImage: participant.adultImage,
      }));
      const validImage = (value) => typeof value === "string"
        && /^data:image\/(?:jpeg|png|webp|gif);base64,/.test(value);
      if (participants.some((participant) => !participant.name
        || !validImage(participant.babyImage)
        || !validImage(participant.adultImage))) {
        json(response, 400, { error: "Each participant needs a name and both photo images." });
        return;
      }
      game = {
        status: "lobby",
        participants,
        players: [],
        roundIndex: -1,
        endsAt: null,
        answers: [],
      };
      sendUpdate();
      json(response, 201, { game: publicGame("quizmaster") });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    try {
      const body = await readJson(request);
      if (!game || game.status === "completed") {
        json(response, 409, { error: "There is no open game to join." });
        return;
      }
      const name = String(body.name || "").trim();
      if (!name || name.length > 32) {
        json(response, 400, { error: "Enter a name of 1 to 32 characters." });
        return;
      }
      const existing = game.players.find((player) => player.id === body.playerId);
      if (existing) {
        existing.name = name;
        json(response, 200, { player: existing });
        sendUpdate();
        return;
      }
      if (game.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
        json(response, 409, { error: "That name is already in the game. Please choose another." });
        return;
      }
      const player = { id: crypto.randomUUID(), name, score: 0 };
      game.players.push(player);
      sendUpdate();
      json(response, 201, { player });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/start") {
    if (!game || game.status !== "lobby") {
      json(response, 409, { error: "Create a game before starting." });
      return;
    }
    if (game.players.length === 0) {
      json(response, 409, { error: "Wait for at least one player to join before starting." });
      return;
    }
    game.status = "playing";
    game.roundIndex = 0;
    game.endsAt = Date.now() + 20_000;
    game.answers[0] = {};
    sendUpdate();
    json(response, 200, { game: publicGame("quizmaster") });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/next-round") {
    if (!game || game.status !== "scores") {
      json(response, 409, { error: "The round results are not ready yet." });
      return;
    }
    if (game.roundIndex + 1 >= game.participants.length) {
      game.status = "completed";
      game.endsAt = null;
    } else {
      game.roundIndex += 1;
      game.status = "playing";
      game.endsAt = Date.now() + 20_000;
      game.answers[game.roundIndex] = {};
    }
    sendUpdate();
    json(response, 200, { game: publicGame("quizmaster") });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/answer") {
    try {
      const body = await readJson(request);
      if (!game || game.status !== "playing" || Date.now() >= game.endsAt) {
        json(response, 409, { error: "This round is not accepting answers." });
        return;
      }
      const player = game.players.find((entry) => entry.id === body.playerId);
      if (!player) {
        json(response, 404, { error: "Join the game before choosing a photo." });
        return;
      }
      const round = game.roundIndex;
      game.answers[round] ||= {};
      if (game.answers[round][player.id]) {
        json(response, 409, { error: "Your answer for this round has already been recorded." });
        return;
      }
      const correct = game.participants[round].id === body.participantId;
      game.answers[round][player.id] = { playerId: player.id, correct };
      if (correct) player.score += 5;
      sendUpdate();
      json(response, 200, {
        correct,
        points: correct ? 5 : 0,
        game: publicGame("player", player.id),
      });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    serveFile(response, "index.html", "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/app.css") {
    serveFile(response, "app.css", "text/css; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    serveFile(response, "app.js", "text/javascript; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/config.js") {
    serveFile(response, "config.js", "text/javascript; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/play") {
    serveFile(response, "index.html", "text/html; charset=utf-8");
    return;
  }
  json(response, 404, { error: "Not found." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Baby Matching Game is running at http://localhost:${PORT}`);
  console.log(`Phone join link: ${process.env.PLAYER_URL || `http://${getLanAddress()}:${PORT}/play`}`);
});
