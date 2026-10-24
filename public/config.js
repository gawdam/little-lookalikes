const isLocalServer = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.GAME_CONFIG = { apiUrl: isLocalServer ? window.location.origin : "" };
