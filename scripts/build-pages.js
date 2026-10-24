const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const publicDirectory = path.join(root, "public");
const outputDirectory = path.join(root, "dist");
const apiUrl = process.env.GAME_API_URL?.trim().replace(/\/+$/, "");

if (!apiUrl) {
  throw new Error("Set GAME_API_URL to the deployed game server URL before building GitHub Pages.");
}

let parsedApiUrl;
try {
  parsedApiUrl = new URL(apiUrl);
} catch {
  throw new Error("GAME_API_URL must be a valid HTTPS URL.");
}
if (parsedApiUrl.protocol !== "https:") {
  throw new Error("GAME_API_URL must use HTTPS.");
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(publicDirectory, outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, "config.js"),
  `window.GAME_CONFIG = ${JSON.stringify({ apiUrl })};\n`,
);
fs.writeFileSync(path.join(outputDirectory, ".nojekyll"), "");
console.log(`GitHub Pages site built in ${outputDirectory}`);
