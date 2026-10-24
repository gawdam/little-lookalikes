const quizmaster = document.querySelector("#quizmaster");
const playerPage = document.querySelector("#player");
const isPlayerPage = window.location.pathname.endsWith("/play")
  || new URLSearchParams(window.location.search).get("view") === "player";
const apiBaseUrl = window.GAME_CONFIG?.apiUrl?.replace(/\/+$/, "") || "";
const participantsElement = document.querySelector("#participant-list");
const participantTemplate = document.querySelector("#participant-template");
const participantCount = document.querySelector("#participant-count");
const createError = document.querySelector("#create-error");
const joinError = document.querySelector("#join-error");
const playerIdKey = "little-lookalikes-player-id";
const backendSetupMessage = "The game server is not connected yet. Deploy the Render service and set the GAME_API_URL GitHub Actions variable, then rerun the Pages deployment.";
let currentGame = null;
let eventSource = null;
let timerInterval = null;
let selectedRound = null;

if (isPlayerPage) {
  quizmaster.hidden = true;
  playerPage.hidden = false;
} else {
  quizmaster.hidden = false;
  playerPage.hidden = true;
}

function addParticipant() {
  const card = participantTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector(".remove-participant").addEventListener("click", () => {
    if (participantsElement.children.length <= 2) {
      showError(createError, "A game needs at least two people.");
      return;
    }
    card.remove();
    updateParticipantCount();
    renumberParticipants();
  });
  for (const [inputSelector, imageSelector, promptSelector] of [
    [".baby-file", ".upload-preview", ".upload-prompt"],
    [".adult-file", ".upload-preview", ".upload-prompt"],
  ]) {
    const input = card.querySelector(inputSelector);
    const image = input.closest(".upload-field").querySelector(imageSelector);
    const prompt = input.closest(".upload-field").querySelector(promptSelector);
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        input.value = "";
        showError(createError, "Each photo must be smaller than 8 MB.");
        return;
      }
      image.src = URL.createObjectURL(file);
      image.hidden = false;
      prompt.hidden = true;
      showError(createError, "");
    });
  }
  participantsElement.append(card);
  updateParticipantCount();
  renumberParticipants();
}

function updateParticipantCount() {
  const count = participantsElement.children.length;
  participantCount.textContent = `${count} ${count === 1 ? "person" : "people"}`;
}

function renumberParticipants() {
  [...participantsElement.children].forEach((card, index) => {
    card.querySelector(".participant-number").textContent = `PERSON ${String(index + 1).padStart(2, "0")}`;
  });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function readFileAsDataUrl(file) {
  const imageUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      try {
        const scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not prepare this photo.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error(`Could not read ${file.name}.`));
    });
    image.src = imageUrl;
  });
}

async function requestJson(url, options = {}) {
  if (!apiBaseUrl) throw new Error(backendSetupMessage);
  const response = await fetch(`${apiBaseUrl}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

document.querySelector("#add-participant")?.addEventListener("click", addParticipant);
document.querySelector("#create-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(createError, "");
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Creating game…";
  try {
    const cards = [...participantsElement.children];
    if (cards.length < 2) throw new Error("Add at least two people to create a game.");
    const participants = await Promise.all(cards.map(async (card) => {
      const babyFile = card.querySelector(".baby-file").files[0];
      const adultFile = card.querySelector(".adult-file").files[0];
      const name = card.querySelector(".person-name").value.trim();
      if (!name || !babyFile || !adultFile) {
        throw new Error("Add a name and both photos for every person.");
      }
      return {
        name,
        babyImage: await readFileAsDataUrl(babyFile),
        adultImage: await readFileAsDataUrl(adultFile),
      };
    }));
    await requestJson("/api/game", { method: "POST", body: JSON.stringify({ participants }) });
    await openGame();
    showSection("play");
  } catch (error) {
    showError(createError, error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Create game <span aria-hidden="true">→</span>';
  }
});

function showSection(section) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  document.querySelector("#create-section").hidden = section !== "create";
  document.querySelector("#play-section").hidden = section !== "play";
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});
document.querySelector("[data-go-create]")?.addEventListener("click", () => showSection("create"));
document.querySelector("#start-game")?.addEventListener("click", async () => {
  try {
    await requestJson("/api/start", { method: "POST", body: "{}" });
    showError(document.querySelector("#play-error"), "");
  } catch (error) {
    showError(document.querySelector("#play-error"), error.message);
  }
});
document.querySelector("#next-round")?.addEventListener("click", async () => {
  try {
    await requestJson("/api/next-round", { method: "POST", body: "{}" });
    showError(document.querySelector("#play-error"), "");
  } catch (error) {
    showError(document.querySelector("#play-error"), error.message);
  }
});

async function openGame() {
  const state = await requestJson("/api/state");
  renderQuizmaster(state.game);
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`${apiBaseUrl}/api/events`);
  eventSource.onmessage = (event) => renderQuizmaster(JSON.parse(event.data));
  eventSource.onerror = () => {
    document.querySelector("#game-status").textContent = "Reconnecting…";
  };
  const joinInfo = await requestJson("/api/join-url");
  document.querySelector("#qr-code").src = joinInfo.qr;
  document.querySelector("#join-link").href = joinInfo.url;
  document.querySelector("#join-link").textContent = joinInfo.url;
}

function renderQuizmaster(game) {
  currentGame = game;
  const noGame = document.querySelector("#no-game");
  const dashboard = document.querySelector("#game-dashboard");
  const status = document.querySelector("#game-status");
  noGame.hidden = Boolean(game);
  dashboard.hidden = !game;
  if (!game) {
    status.textContent = "No game yet";
    status.classList.remove("live");
    return;
  }
  const statusText = {
    lobby: "Waiting to start",
    playing: "Round in progress",
    scores: "Round results",
    completed: "Game complete",
  }[game.status];
  status.textContent = statusText;
  status.classList.toggle("live", game.status === "playing");
  const lobby = document.querySelector("#lobby-screen");
  const round = document.querySelector("#round-screen");
  const scores = document.querySelector("#scores-screen");
  const results = document.querySelector("#final-results");
  lobby.hidden = game.status !== "lobby";
  round.hidden = game.status !== "playing";
  scores.hidden = game.status !== "scores";
  results.hidden = game.status !== "completed";
  if (game.status === "lobby") {
    document.querySelector("#player-count").textContent = game.players.length;
    renderLobbyPlayers(game.players);
  } else if (game.status === "playing") {
    const participant = game.participants[game.roundIndex];
    document.querySelector("#round-label").textContent = `ROUND ${game.roundNumber} OF ${game.totalRounds}`;
    const babyPhoto = document.querySelector("#baby-photo");
    babyPhoto.src = participant.babyImage;
    babyPhoto.hidden = false;
    document.querySelector("#round-hint").textContent =
      `${game.answeredCount} ${game.answeredCount === 1 ? "player has" : "players have"} made a guess`;
    document.querySelector("#round-progress").innerHTML = game.participants.map((_, index) =>
      `<span class="${index < game.roundIndex ? "done" : ""} ${index === game.roundIndex ? "current" : ""}"></span>`,
    ).join("");
    renderTimer(document.querySelector("#timer"), game.endsAt);
  } else if (game.status === "scores") {
    const reveal = game.participants[game.roundIndex];
    document.querySelector("#scores-title").textContent = `Round ${game.roundNumber} scores`;
    document.querySelector("#answer-name").textContent = reveal.name;
    document.querySelector("#answer-guesses").textContent = game.roundResult.correctPlayers.length
      ? `Guessed correctly by ${game.roundResult.correctPlayers.join(", ")}`
      : "No correct guesses this round";
    renderScores(game.players);
    document.querySelector("#next-round").innerHTML = game.roundIndex + 1 === game.totalRounds
      ? 'See final results <span aria-hidden="true">→</span>'
      : 'Next baby <span aria-hidden="true">→</span>';
  } else {
    renderResults(game);
  }
}

function renderScores(players, listId = "score-list") {
  const list = document.getElementById(listId);
  if (!players.length) {
    list.innerHTML = '<p class="score-empty">Players appear here when they join.</p>';
    return;
  }
  list.innerHTML = [...players].sort((a, b) => b.score - a.score).map((player) =>
    `<div class="score-row"><span class="score-name"><span class="score-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(player.name)}</span><span class="score-points">${player.score} pts</span></div>`,
  ).join("");
}

function renderLobbyPlayers(players) {
  const list = document.querySelector("#lobby-player-list");
  if (!players.length) {
    list.innerHTML = '<p class="score-empty">Players appear here when they join.</p>';
    return;
  }
  list.innerHTML = players.map((player) =>
    `<div class="score-row"><span class="score-name"><span class="score-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(player.name)}</span><span class="joined-label">Joined</span></div>`,
  ).join("");
}

function renderResults(game) {
  const results = document.querySelector("#final-results");
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  results.innerHTML = `<h2>And the lookalike champion is…</h2><p>${winner ? `${escapeHtml(winner.name)} takes the crown with ${winner.score} points!` : "Thanks for playing!"}</p>${sorted.map((player, index) =>
    `<div class="result-winner"><strong>${index + 1}. ${escapeHtml(player.name)}</strong><span>${player.score} points</span></div>`,
  ).join("")}<h2 style="margin-top:24px">The baby-to-grown-up reveal</h2>${game.results.map((result) =>
    `<div class="round-results"><div>${escapeHtml(result.name)}<small>${result.correctPlayers.length ? `Correctly guessed by ${result.correctPlayers.map(escapeHtml).join(", ")}` : "No correct guesses this round"}</small></div></div>`,
  ).join("")}`;
}

function renderTimer(element, endsAt) {
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  element.classList.toggle("urgent", seconds <= 10);
  element.innerHTML = `<span class="timer-dot"></span> 00:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function startPlayerPage() {
  const playerId = localStorage.getItem(playerIdKey);
  if (!playerId) {
    document.querySelector("#phone-join").hidden = false;
  }
  const state = await requestJson(`/api/state?view=player${playerId ? `&playerId=${encodeURIComponent(playerId)}` : ""}`);
  if (!state.game) {
    document.querySelector("#phone-join").hidden = true;
    document.querySelector("#phone-no-game").hidden = false;
    return;
  }
  if (playerId) {
    const registered = state.game.players.find((player) => player.id === playerId);
    if (registered) {
      document.querySelector("#phone-join").hidden = true;
      document.querySelector("#waiting-name").textContent = registered.name;
    } else {
      localStorage.removeItem(playerIdKey);
      document.querySelector("#phone-join").hidden = false;
    }
  }
  renderPlayer(state.game);
  connectPlayerEvents();
}

function connectPlayerEvents() {
  if (eventSource) eventSource.close();
  const playerId = localStorage.getItem(playerIdKey);
  const query = playerId ? `?view=player&playerId=${encodeURIComponent(playerId)}` : "?view=player";
  eventSource = new EventSource(`${apiBaseUrl}/api/events${query}`);
  eventSource.onmessage = (event) => renderPlayer(JSON.parse(event.data));
}

document.querySelector("#join-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(joinError, "");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await requestJson("/api/join", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#player-name").value.trim(),
        playerId: localStorage.getItem(playerIdKey),
      }),
    });
    localStorage.setItem(playerIdKey, result.player.id);
    document.querySelector("#phone-join").hidden = true;
    document.querySelector("#phone-no-game").hidden = true;
    document.querySelector("#waiting-name").textContent = result.player.name;
    document.querySelector("#phone-waiting").hidden = false;
    connectPlayerEvents();
  } catch (error) {
    showError(joinError, error.message);
  } finally {
    button.disabled = false;
  }
});

function renderPlayer(game) {
  currentGame = game;
  document.querySelector("#phone-no-game").hidden = Boolean(game);
  if (!game) return;
  const playerId = localStorage.getItem(playerIdKey);
  const player = game.players.find((entry) => entry.id === playerId);
  if (!player) {
    document.querySelector("#phone-join").hidden = false;
    document.querySelector("#phone-waiting").hidden = true;
    document.querySelector("#phone-playing").hidden = true;
    document.querySelector("#phone-finished").hidden = true;
    return;
  }
  document.querySelector("#phone-join").hidden = true;
  document.querySelector("#phone-no-game").hidden = true;
  document.querySelector("#phone-waiting").hidden = game.status !== "lobby";
  document.querySelector("#phone-playing").hidden = game.status !== "playing";
  document.querySelector("#phone-round-scores").hidden = game.status !== "scores";
  document.querySelector("#phone-finished").hidden = game.status !== "completed";
  document.querySelector("#waiting-name").textContent = player.name;
  if (game.status === "playing") {
    document.querySelector("#phone-round-label").textContent = `ROUND ${game.roundNumber} OF ${game.totalRounds}`;
    renderTimer(document.querySelector("#phone-timer"), game.endsAt);
    const answered = game.playerAnswer;
    if (selectedRound !== game.roundIndex) {
      selectedRound = game.roundIndex;
      renderAdultOptions(game, answered);
    }
    if (answered) showAnswerFeedback(answered, player.score);
  }
  if (game.status === "scores") {
    document.querySelector("#phone-round-feedback").textContent = game.playerAnswer
      ? game.playerAnswer.correct
        ? `Correct! You earned 5 points and now have ${player.score} total.`
        : "Not quite this time. Your guess has been counted."
      : "Time ran out before you made a guess this round.";
  }
  if (game.status === "completed") {
    document.querySelector("#phone-final-score").textContent = `${player.score} points`;
  }
}

function renderAdultOptions(game, answered) {
  const options = document.querySelector("#adult-options");
  options.innerHTML = game.participants.map((participant) =>
    `<button class="adult-option" type="button" data-participant="${participant.id}" ${answered ? "disabled" : ""}><img src="${participant.adultImage}" alt=""><span>${escapeHtml(participant.name)}</span></button>`,
  ).join("");
  options.querySelectorAll(".adult-option").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(button.dataset.participant, button));
  });
  document.querySelector("#answer-feedback").hidden = !answered;
}

async function submitAnswer(participantId, button) {
  const playerId = localStorage.getItem(playerIdKey);
  const options = document.querySelector("#adult-options");
  options.querySelectorAll("button").forEach((option) => { option.disabled = true; });
  button.classList.add("selected");
  try {
    const result = await requestJson("/api/answer", {
      method: "POST",
      body: JSON.stringify({ participantId, playerId }),
    });
    showAnswerFeedback(result, result.game.players.find((player) => player.id === playerId)?.score || 0);
  } catch (error) {
    options.querySelectorAll("button").forEach((option) => { option.disabled = false; });
    showError(document.querySelector("#answer-feedback"), error.message);
    document.querySelector("#answer-feedback").hidden = false;
  }
}

function showAnswerFeedback(answer, totalScore) {
  const feedback = document.querySelector("#answer-feedback");
  feedback.hidden = false;
  feedback.classList.toggle("wrong", !answer.correct);
  feedback.textContent = answer.correct
    ? `That’s a match! +5 points · ${totalScore} total`
    : "Not this time! Your answer is in — watch the big screen.";
  document.querySelectorAll(".adult-option").forEach((option) => { option.disabled = true; });
}

if (isPlayerPage) {
  startPlayerPage().catch((error) => {
    document.querySelector("#phone-join").hidden = true;
    document.querySelector("#phone-no-game").hidden = false;
    document.querySelector("#phone-no-game").textContent = error.message;
    if (apiBaseUrl) console.error("Could not load the game:", error);
  });
}

if (!isPlayerPage) {
  addParticipant();
  addParticipant();
  requestJson("/api/state").then(({ game }) => {
    if (game) {
      openGame()
        .then(() => showSection("play"))
        .catch((error) => {
          document.querySelector("#game-status").textContent = "Server unavailable";
          document.querySelector("#no-game-message").textContent = error.message;
          if (apiBaseUrl) console.error("Could not connect to the game:", error);
        });
    }
  }).catch((error) => {
    document.querySelector("#game-status").textContent = "Server unavailable";
    document.querySelector("#no-game-message").textContent = error.message;
    if (apiBaseUrl) console.error("Could not load the game:", error);
  });
}

timerInterval = window.setInterval(() => {
  const masterTimer = document.querySelector("#timer");
  const phoneTimer = document.querySelector("#phone-timer");
  if (currentGame?.status === "playing" && masterTimer) renderTimer(masterTimer, currentGame.endsAt);
  if (isPlayerPage && phoneTimer && !document.querySelector("#phone-playing").hidden) {
    if (currentGame?.status === "playing") renderTimer(phoneTimer, currentGame.endsAt);
  }
}, 1000);
