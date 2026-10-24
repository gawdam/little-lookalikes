# Little Lookalikes

A baby-photo matching game with a quizmaster screen and live phone participation.

## Run the game

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on the quizmaster's computer.
5. Add a name, a baby photo, and a grown-up photo for at least two people, then create the game.
6. Ask players to join the same Wi-Fi network and scan the QR code. If the QR code does not work, open the displayed join link on their phones.
7. Start the game when everyone has joined.

The quizmaster first shows the QR code and player list. After starting, each baby photo is shown for a 20-second round, followed by a separate scores and answer-reveal screen. The quizmaster advances to each next round and can view the final leaderboard after the last one. Players choose the matching grown-up photo on their phones. Each correct answer earns 5 points.

Keep the quizmaster's browser tab open throughout the game. Photos and game state are held in the running server's memory and are cleared when the server stops or a new game is created.

## Publish with GitHub Pages and Render

GitHub Pages serves the static game interface. The Node server must run separately to handle live game state, photos, timers, and scores. This repository includes a Render Blueprint and a GitHub Actions Pages workflow. The Pages interface can be deployed before the backend is configured, but multiplayer will show a setup message until the backend URL is set.

1. Push this repository to the `main` branch on GitHub.
2. In Render, create a new **Blueprint** from this repository and deploy `render.yaml`. This creates the `little-lookalikes-api` web service.
3. In the GitHub repository, open **Settings → Pages** and set the source to **GitHub Actions**.
4. Once Render has deployed, copy the service's HTTPS URL (for example, `https://little-lookalikes-api.onrender.com`).
5. In GitHub, open **Settings → Secrets and variables → Actions → Variables**, add a repository variable named `GAME_API_URL`, and set it to the Render service URL without a trailing slash.
6. Run **Actions → Deploy GitHub Pages → Run workflow**, or push another commit to `main`.
7. Open `https://gawdam.github.io/little-lookalikes/` to use the game. The Render service is configured to generate phone join links for this Pages URL.

The Render service's `CORS_ORIGIN` and `PLAYER_URL` are set in `render.yaml`. If the repository or Pages URL changes, update those values and redeploy the Render Blueprint. The backend's game state and uploaded photos are in memory, not persistent storage; a service restart clears the current game. Only use photos you have permission to share with the players.

### Build the Pages site locally

Set `GAME_API_URL` to the deployed backend URL, then run `npm run build:pages`. The static site is written to `dist`.
