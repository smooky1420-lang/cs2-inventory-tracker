# CS2 Inventory Tracker

Local web app that logs into Steam, reads CS2 inventory from the Game Coordinator (including Storage Units), stores cost basis, and values holdings on CSFloat.

## Download the Windows app

If you just want to run it:

1. Grab `CS2InventoryTracker.exe` from [Releases](../../releases).
2. Put it in its own folder.
3. Run it once. It creates a `.env` file next to the exe.
4. Edit `.env` with your Steam username and password (wrap the password in double quotes if it contains `#`).
5. Run the exe again. It opens [http://localhost:3000](http://localhost:3000). Keep the console window open.

Your inventory, buy prices, and price history are saved in a `data` folder next to the exe.

Windows may warn that the app is unsigned. Choose **More info** → **Run anyway**.

## Run from source

For changes, or if you already have Node.js 18+:

```bash
git clone <your-repo-url>
cd "CS2 Portfolio Tracker"
npm install
copy .env.example .env
```

Edit `.env`:

- `STEAM_ACCOUNT_NAME` / `STEAM_PASSWORD` — Steam login
- `STEAM_SHARED_SECRET` — optional; auto-fills Steam Guard TOTP
- `CSFLOAT_API_KEY` — optional but recommended (CSFloat profile → Developer)

```bash
npm start
```

Opens `http://localhost:3000` with dashboard + inventory pages, storage-unit breakdowns, weighted-average buy prices, Steam sync, and CSFloat refresh.

Steam Guard codes can be entered in the browser if a refresh token is not already saved.

CLI still works:

```bash
npm run cli
npm run cli -- --offline
npm run cli -- --set-price "Kilowatt Case" 0.45
```

## Build the .exe yourself

Needs Node.js 22+ (24 recommended).

```bash
npm install
npm run pack:win
```

The file lands at `release/CS2InventoryTracker.exe`. GitHub Actions also builds it when you publish a Release.

Prices come from CSFloat's bulk price index, then a short parallel lookup only for items missing from that index.

> Syncing Steam takes over the CS2 Game Coordinator session for that account. Close CS2 on other devices first.
