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
  if (quizmaster) quizmaster.hidden = true;
  if (playerPage) playerPage.hidden = false;
} else {
  if (quizmaster) quizmaster.hidden = false;
  if (playerPage) playerPage.hidden = true;
}

function addParticipant() {
  if (!participantsElement || !participantTemplate) return;
  const card = participantTemplate.content.firstElementChild.cloneNode(true);
  const removeButton = card.querySelector(".remove-participant");
  if (removeButton) {
    removeButton.addEventListener("click", () => {
      if (participantsElement.children.length <= 2) {
        showError(createError, "A game needs at least two people.");
        return;
      }
      card.remove();
      updateParticipantCount();
      renumberParticipants();
    });
  }
  for (const [inputSelector, imageSelector, promptSelector] of [
    [".baby-file", ".upload-preview", ".upload-prompt"],
    [".adult-file", ".upload-preview", ".upload-prompt"],
  ]) {
    const input = card.querySelector(inputSelector);
    if (!input) continue;
    const uploadField = input.closest(".upload-field");
    if (!uploadField) continue;
    const image = uploadField.querySelector(imageSelector);
    const prompt = uploadField.querySelector(promptSelector);
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        input.value = "";
        showError(createError, "Each photo must be smaller than 8 MB.");
        return;
      }
      if (image) {
        image.src = URL.createObjectURL(file);
        image.hidden = false;
      }
      if (prompt) {
        prompt.hidden = true;
      }
      showError(createError, "");
    });
  }
  participantsElement.append(card);
  updateParticipantCount();
  renumberParticipants();
}

function updateParticipantCount() {
  if (!participantsElement || !participantCount) return;
  const count = participantsElement.children.length;
  participantCount.textContent = `${count} ${count === 1 ? "person" : "people"}`;
}

function renumberParticipants() {
  if (!participantsElement) return;
  [...participantsElement.children].forEach((card, index) => {
    const number = card.querySelector(".participant-number");
    if (number) {
      number.textContent = `PERSON ${String(index + 1).padStart(2, "0")}`;
    }
  });
}

function showError(element, message) {
  if (!element) return;
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
  if (!submitButton) return;
  submitButton.disabled = true;
  submitButton.textContent = "Creating game…";
  try {
    const cards = [...(participantsElement?.children || [])];
    if (cards.length < 2) throw new Error("Add at least two people to create a game.");
    const participants = await Promise.all(cards.map(async (card) => {
      const babyFile = card.querySelector(".baby-file")?.files[0];
      const adultFile = card.querySelector(".adult-file")?.files[0];
      const name = card.querySelector(".person-name")?.value.trim();
      if (!name || !babyFile || !adultFile) {
        throw new Error("Add a name and both photos for every person.");
      }
      return {
        name,
        babyImage: await readFileAsDataUrl(babyFile),
        adultImage: await readFileAsDataUrl(adultFile),
      };
    }));
    const durationSeconds = Number(
      event.currentTarget.querySelector('input[name="round-duration"]:checked')?.value,
    );
    await requestJson("/api/game", {
      method: "POST",
      body: JSON.stringify({ participants, durationSeconds }),
    });
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
  const createSection = document.querySelector("#create-section");
  const playSection = document.querySelector("#play-section");
  if (createSection) createSection.hidden = section !== "create";
  if (playSection) playSection.hidden = section !== "play";
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
    const status = document.querySelector("#game-status");
    if (status) status.textContent = "Reconnecting…";
  };
  const joinInfo = await requestJson("/api/join-url");
  const qrCode = document.querySelector("#qr-code");
  const joinLink = document.querySelector("#join-link");
  if (qrCode) qrCode.src = joinInfo.qr;
  if (joinLink) {
    joinLink.href = joinInfo.url;
    joinLink.textContent = joinInfo.url;
  }
}

function renderQuizmaster(game) {
  currentGame = game;
  const noGame = document.querySelector("#no-game");
  const dashboard = document.querySelector("#game-dashboard");
  const status = document.querySelector("#game-status");
  if (noGame) noGame.hidden = Boolean(game);
  if (dashboard) dashboard.hidden = !game;
  if (!status) return;
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
  if (lobby) lobby.hidden = game.status !== "lobby";
  if (round) round.hidden = game.status !== "playing";
  if (scores) scores.hidden = game.status !== "scores";
  if (results) results.hidden = game.status !== "completed";
  if (game.status === "lobby") {
    const playerCount = document.querySelector("#player-count");
    if (playerCount) playerCount.textContent = game.players.length;
    renderLobbyPlayers(game.players);
  } else if (game.status === "playing") {
    const participant = game.participants[game.roundIndex];
    const roundLabel = document.querySelector("#round-label");
    if (roundLabel) roundLabel.textContent = `ROUND ${game.roundNumber} OF ${game.totalRounds}`;
    const babyPhoto = document.querySelector("#baby-photo");
    if (babyPhoto && participant) {
      babyPhoto.src = participant.babyImage;
      babyPhoto.hidden = false;
    }
    const roundHint = document.querySelector("#round-hint");
    if (roundHint) {
      roundHint.textContent =
        `${game.answeredCount} ${game.answeredCount === 1 ? "player has" : "players have"} made a guess`;
    }
    const roundProgress = document.querySelector("#round-progress");
    if (roundProgress) {
      roundProgress.innerHTML = game.participants.map((_, index) =>
        `<span class="${index < game.roundIndex ? "done" : ""} ${index === game.roundIndex ? "current" : ""}"></span>`,
      ).join("");
    }
    renderTimer(document.querySelector("#timer"), game.endsAt);
  } else if (game.status === "scores") {
    const reveal = game.participants[game.roundIndex];
    const scoresTitle = document.querySelector("#scores-title");
    if (scoresTitle) scoresTitle.textContent = `Round ${game.roundNumber} scores`;
    const answerBabyPhoto = document.querySelector("#answer-baby-photo");
    const answerAdultPhoto = document.querySelector("#answer-adult-photo");
    if (answerBabyPhoto) answerBabyPhoto.src = game.roundResult.babyImage;
    if (answerAdultPhoto) answerAdultPhoto.src = game.roundResult.adultImage;
    const answerName = document.querySelector("#answer-name");
    if (answerName && reveal) answerName.textContent = reveal.name;
    const answerGuesses = document.querySelector("#answer-guesses");
    if (answerGuesses) {
      answerGuesses.textContent = game.roundResult.correctPlayers.length
        ? `Guessed correctly by ${game.roundResult.correctPlayers.join(", ")}`
        : "No correct guesses this round";
    }
    renderRoundScores(game.roundResult.scores);
    const nextRound = document.querySelector("#next-round");
    if (nextRound) {
      nextRound.innerHTML = game.roundIndex + 1 === game.totalRounds
        ? 'See final results <span aria-hidden="true">→</span>'
        : 'Next baby <span aria-hidden="true">→</span>';
    }
  } else {
    renderResults(game);
  }
}

function renderScores(players, listId = "score-list") {
  const list = document.getElementById(listId);
  if (!list) return;
  if (!players.length) {
    list.innerHTML = '<p class="score-empty">Players appear here when they join.</p>';
    return;
  }
  list.innerHTML = [...players].sort((a, b) => b.score - a.score).map((player) =>
    `<div class="score-row"><span class="score-name"><span class="score-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(player.name)}</span><span class="score-points">${player.score} pts</span></div>`,
  ).join("");
}

function renderRoundScores(players) {
  const list = document.querySelector("#score-list");
  if (!list) return;
  if (!players.length) {
    list.innerHTML = '<p class="score-empty">No players joined this game.</p>';
    return;
  }
  list.innerHTML = [...players]
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .map((player) =>
      `<div class="score-row"><span class="score-name"><span class="score-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(player.name)}</span><span class="score-points">${player.points} pts</span></div>`,
    )
    .join("");
}

function renderLobbyPlayers(players) {
  const list = document.querySelector("#lobby-player-list");
  if (!list) return;
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
  if (!results) return;
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  results.innerHTML = `<h2>And the lookalike champion is…</h2><p>${winner ? `${escapeHtml(winner.name)} takes the crown with ${winner.score} points!` : "Thanks for playing!"}</p>${sorted.map((player, index) =>
    `<div class="result-winner"><strong>${index + 1}. ${escapeHtml(player.name)}</strong><span>${player.score} points</span></div>`,
  ).join("")}<h2 style="margin-top:24px">The baby-to-grown-up reveal</h2>${game.results.map((result) =>
    `<div class="round-results"><div>${escapeHtml(result.name)}<small>${result.correctPlayers.length ? `Correctly guessed by ${result.correctPlayers.map(escapeHtml).join(", ")}` : "No correct guesses"}</small></div></div>`,
  ).join("")}`;
}

function renderTimer(element, endsAt) {
  if (!element) return;
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
  const playerJoin = document.querySelector("#phone-join");
  if (!playerJoin) return;
  const playerId = localStorage.getItem(playerIdKey);
  if (!playerId) {
    playerJoin.hidden = false;
  }
  const state = await requestJson(`/api/state?view=player${playerId ? `&playerId=${encodeURIComponent(playerId)}` : ""}`);
  const phoneNoGame = document.querySelector("#phone-no-game");
  if (!state.game) {
    if (phoneNoGame) phoneNoGame.hidden = false;
    playerJoin.hidden = true;
    return;
  }
  if (playerId) {
    const registered = state.game.players.find((player) => player.id === playerId);
    if (registered) {
      playerJoin.hidden = true;
      const waitingName = document.querySelector("#waiting-name");
      if (waitingName) waitingName.textContent = registered.name;
    } else {
      localStorage.removeItem(playerIdKey);
      playerJoin.hidden = false;
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
  if (!button) return;
  button.disabled = true;
  try {
    const result = await requestJson("/api/join", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#player-name")?.value.trim(),
        playerId: localStorage.getItem(playerIdKey),
      }),
    });
    if (!result?.player?.id) throw new Error("The server did not return a valid player.");
    localStorage.setItem(playerIdKey, result.player.id);
    const phoneJoin = document.querySelector("#phone-join");
    const phoneNoGame = document.querySelector("#phone-no-game");
    const waitingName = document.querySelector("#waiting-name");
    if (phoneJoin) phoneJoin.hidden = true;
    if (phoneNoGame) phoneNoGame.hidden = true;
    if (waitingName) waitingName.textContent = result.player.name;
    const phoneWaiting = document.querySelector("#phone-waiting");
    if (phoneWaiting) phoneWaiting.hidden = false;
    connectPlayerEvents();
  } catch (error) {
    showError(joinError, error.message);
  } finally {
    button.disabled = false;
  }
});

function renderPlayer(game) {
  currentGame = game;
  const phoneNoGame = document.querySelector("#phone-no-game");
  if (phoneNoGame) phoneNoGame.hidden = Boolean(game);
  if (!game) return;
  const playerId = localStorage.getItem(playerIdKey);
  const player = game.players.find((entry) => entry.id === playerId);
  const phoneJoin = document.querySelector("#phone-join");
  const phoneWaiting = document.querySelector("#phone-waiting");
  const phonePlaying = document.querySelector("#phone-playing");
  const phoneFinished = document.querySelector("#phone-finished");
  if (!player) {
    if (phoneJoin) phoneJoin.hidden = false;
    if (phoneWaiting) phoneWaiting.hidden = true;
    if (phonePlaying) phonePlaying.hidden = true;
    if (phoneFinished) phoneFinished.hidden = true;
    return;
  }
  if (phoneJoin) phoneJoin.hidden = true;
  if (phoneNoGame) phoneNoGame.hidden = true;
  if (phoneWaiting) phoneWaiting.hidden = game.status !== "lobby";
  if (phonePlaying) phonePlaying.hidden = game.status !== "playing";
  const phoneRoundScores = document.querySelector("#phone-round-scores");
  if (phoneRoundScores) phoneRoundScores.hidden = game.status !== "scores";
  if (phoneFinished) phoneFinished.hidden = game.status !== "completed";
  const waitingName = document.querySelector("#waiting-name");
  if (waitingName) waitingName.textContent = player.name;
  if (game.status === "playing") {
    const phoneRoundLabel = document.querySelector("#phone-round-label");
    if (phoneRoundLabel) phoneRoundLabel.textContent = `ROUND ${game.roundNumber} OF ${game.totalRounds}`;
    renderTimer(document.querySelector("#phone-timer"), game.endsAt);
    const answered = game.playerAnswer;
    if (selectedRound !== game.roundIndex) {
      selectedRound = game.roundIndex;
      renderAdultOptions(game, answered);
    }
    if (answered) showAnswerFeedback(answered);
  }
  if (game.status === "scores") {
    const phoneRoundFeedback = document.querySelector("#phone-round-feedback");
    if (phoneRoundFeedback) {
      phoneRoundFeedback.textContent = game.playerAnswer
        ? game.playerAnswer.correct
          ? "Correct! You earned 5 points this round."
          : "Not quite this time. You earned 0 points this round."
        : "Time ran out. You earned 0 points this round.";
    }
  }
  if (game.status === "completed") {
    const phoneFinalScore = document.querySelector("#phone-final-score");
    if (phoneFinalScore) phoneFinalScore.textContent = `${player.score} points`;
  }
}

function renderAdultOptions(game, answered) {
  const options = document.querySelector("#adult-options");
  if (!options) return;
  const shuffledParticipants = [...game.participants];
  for (let index = shuffledParticipants.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledParticipants[index], shuffledParticipants[swapIndex]] =
      [shuffledParticipants[swapIndex], shuffledParticipants[index]];
  }
  if (shuffledParticipants.length > 1
    && shuffledParticipants.every((participant, index) => participant.id === game.participants[index].id)) {
    shuffledParticipants.push(shuffledParticipants.shift());
  }
  options.innerHTML = shuffledParticipants.map((participant) =>
    `<button class="adult-option" type="button" data-participant="${participant.id}" ${answered ? "disabled" : ""}><img src="${participant.adultImage}" alt=""><span>${escapeHtml(participant.name)}</span></button>`,
  ).join("");
  options.querySelectorAll(".adult-option").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(button.dataset.participant, button));
  });
  const answerFeedback = document.querySelector("#answer-feedback");
  if (answerFeedback) answerFeedback.hidden = !answered;
}

async function submitAnswer(participantId, button) {
  const playerId = localStorage.getItem(playerIdKey);
  const options = document.querySelector("#adult-options");
  if (!options) return;
  options.querySelectorAll("button").forEach((option) => { option.disabled = true; });
  button.classList.add("selected");
  try {
    const result = await requestJson("/api/answer", {
      method: "POST",
      body: JSON.stringify({ participantId, playerId }),
    });
    showAnswerFeedback(result);
  } catch (error) {
    options.querySelectorAll("button").forEach((option) => { option.disabled = false; });
    const answerFeedback = document.querySelector("#answer-feedback");
    if (answerFeedback) {
      showError(answerFeedback, error.message);
      answerFeedback.hidden = false;
    }
  }
}

function showAnswerFeedback(answer) {
  const feedback = document.querySelector("#answer-feedback");
  if (!feedback) return;
  feedback.hidden = false;
  feedback.classList.toggle("wrong", !answer.correct);
  feedback.textContent = answer.correct
    ? "That’s a match! +5 points this round."
    : "Not this time! Your answer is in — watch the big screen.";
  document.querySelectorAll(".adult-option").forEach((option) => { option.disabled = true; });
}

if (isPlayerPage) {
  startPlayerPage().catch((error) => {
    const phoneJoin = document.querySelector("#phone-join");
    const phoneNoGame = document.querySelector("#phone-no-game");
    if (phoneJoin) phoneJoin.hidden = true;
    if (phoneNoGame) {
      phoneNoGame.hidden = false;
      phoneNoGame.textContent = error.message;
    }
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
          const status = document.querySelector("#game-status");
          const noGameMessage = document.querySelector("#no-game-message");
          if (status) status.textContent = "Server unavailable";
          if (noGameMessage) noGameMessage.textContent = error.message;
          if (apiBaseUrl) console.error("Could not connect to the game:", error);
        });
    }
  }).catch((error) => {
    const status = document.querySelector("#game-status");
    const noGameMessage = document.querySelector("#no-game-message");
    if (status) status.textContent = "Server unavailable";
    if (noGameMessage) noGameMessage.textContent = error.message;
    if (apiBaseUrl) console.error("Could not load the game:", error);
  });
}

timerInterval = window.setInterval(() => {
  const masterTimer = document.querySelector("#timer");
  const phoneTimer = document.querySelector("#phone-timer");
  if (currentGame?.status === "playing" && masterTimer) renderTimer(masterTimer, currentGame.endsAt);
  if (isPlayerPage && phoneTimer && !document.querySelector("#phone-playing")?.hidden) {
    if (currentGame?.status === "playing") renderTimer(phoneTimer, currentGame.endsAt);
  }
}, 1000);
