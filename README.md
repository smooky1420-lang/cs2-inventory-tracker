# CS2 Inventory Tracker

Local web app that logs into Steam, reads CS2 inventory from the Game Coordinator (including Storage Units), stores cost basis, and values holdings on CSFloat.

## Download the Windows app

1. Grab `CS2InventoryTracker-windows.zip` from [Releases](../../releases).
2. Unzip it. You should get a folder with:
   - `CS2InventoryTracker.exe`
   - `config.env`
   - `README.txt`
3. Open `config.env` in Notepad and add your Steam username and password (keep the quotes if the password contains `#`).
4. Double-click the exe. Keep the console window open. It opens [http://localhost:3000](http://localhost:3000).

After the first Steam sync, a `data` folder appears next to the exe (inventory, prices, and Steam login cache).

Windows may warn that the app is unsigned. Choose **More info** → **Run anyway**.

## Run from source

For changes, or if you already have Node.js 18+:

```bash
git clone https://github.com/smooky1420-lang/cs2-inventory-tracker.git
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

The zip lands at `release/CS2InventoryTracker-windows.zip`. GitHub Actions also builds it when you publish a Release.

Prices come from CSFloat's bulk price index, then a short parallel lookup only for items missing from that index.

> Syncing Steam takes over the CS2 Game Coordinator session for that account. Close CS2 on other devices first.
