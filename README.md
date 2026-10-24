# Little Lookalikes

A baby-photo matching game for a host and players on the same Wi-Fi network.

## Run the game

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on the quizmaster's computer.
5. Add a name, a baby photo, and a grown-up photo for at least two people, then create the game.
6. Ask players to join the same Wi-Fi network and scan the QR code. If the QR code does not work, open the displayed join link on their phones.
7. Start the game when everyone has joined.

The quizmaster first shows the QR code and player list. After starting, each baby photo is shown for a 20-second round, followed by a separate scores and answer-reveal screen. The quizmaster advances to each next round and can view the final leaderboard after the last one. Players choose the matching grown-up photo on their phones. Each correct answer earns 5 points.

Keep the quizmaster's computer and the browser tab open throughout the game. Photos and game state are held in the running server's memory and are cleared when the server stops or a new game is created. On networks with client isolation, allow local-network access for Node.js or use a network where devices can reach each other.
