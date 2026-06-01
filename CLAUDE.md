# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — Run the Electron app in development mode (DevTools open when `NODE_ENV=development`).
- `npm run build` — Build Windows installer (`nsis` target, x64) via `electron-builder`.
- `npm run build:portable` — Build a portable Windows executable.
- `npm run postinstall` — Rebuild native dependencies (sharp) for the current Electron version.

There is **no test runner or linter configured**. Playwright is listed in `devDependencies` but unused.

## Architecture Overview

This is an **Electron desktop app** for printing Aadhaar/passport photos. It uses a standard main/renderer split with a secure preload bridge.

### Process Model

- **Main process** (`src/main/main.js`): Entry point. Enforces single-instance lock, creates the BrowserWindow, and registers all IPC handlers. No menu bar (`Menu.setApplicationMenu(null)`).
- **Preload** (`src/main/preload.js`): The only bridge between renderer and main. Uses `contextIsolation: true` + `nodeIntegration: false`. Exposes a curated API via `contextBridge.exposeInMainWorld('electronAPI', ...)`. IPC channels are whitelisted in `ALLOWED_INVOKE_CHANNELS` and `ALLOWED_RECEIVE_CHANNELS`.
- **Renderer** (`src/renderer/`): Vanilla JS (no framework). All modules are IIFEs that attach to `window`.

### Main-Process Modules

| Module | Responsibility |
|--------|----------------|
| `imageProcessor.js` | Sharp-based image processing. Resizes to 413×531 px (35mm×45mm at 300 DPI) with auto-rotate, smart crop (`position: 'attention'`), histogram normalization, brightness/contrast/saturation adjustments. Sharp is loaded with an `asar-unpacked` fallback for packaged builds. |
| `printManager.js` | Creates a hidden `BrowserWindow`, writes print-ready HTML to a temp file, loads it, waits for images to load, then calls `webContents.print()` or `webContents.printToPDF()`. Supports grid layouts and Aadhaar card mode with absolute positioning. |
| `dataStore.js` | Custom JSON-file persistence in Electron's `userData` folder. **Does not use `electron-store`** despite the dependency; uses plain `fs` with atomic write-to-temp-then-rename. Stores settings, daily print counts, customer records, and recent photo paths. |
| `fileManager.js` | File-system operations: saves to a `recent/` folder inside `userData`, lists recent photos with thumbnails, creates customer-named backups under `Documents/AadhaarPhotoPrinter/backup/YYYY-MM-DD/[customerName]/`, and cleans up old files. |
| `geminiAI.js` | Optional Gemini Vision integration (`gemini-2.0-flash`) for photo quality analysis. Entirely optional — the app functions fully without it. Wrapped in timeouts and graceful fallbacks. |

### Renderer Architecture

All renderer scripts are vanilla JS IIFEs attached to `window`:

- `app.js` — The central controller. Owns `appState` (the single source of truth). Handles file uploads, photo processing orchestration, print/PDF export, settings, and keyboard shortcuts (`Ctrl+O` open, `Ctrl+P` print, `Ctrl+E` export PDF, `Escape` close modals). Photos are processed one-by-one (not batched).
- `photoGrid.js` — Renders the photo list in the left panel. Handles add/remove/processing states and AI badges.
- `preview.js` — Renders the A4 page preview in the center panel. Supports two modes: **grid** (CSS grid with configurable cols/rows) and **aadhaar-card** (absolute-positioned draggable/resizable slots for front/back images).
- `receipts.js` — Generates and prints customer receipts in a popup window.
- `ui.js` — Shared UI primitives: toast notifications, modals, dark mode toggle, drag-and-drop zone setup.

**Inter-module communication** happens through globals: `window.appState`, `window.handleRemovePhoto`, `window.handleFilesSelected`, and the exposed module objects (`UIManager`, `PhotoGrid`, `PagePreview`, `ReceiptManager`).

### Data Flow for Photos

1. Files dropped/selected → `app.js` creates photo objects and pushes to `appState.photos`.
2. `PhotoGrid.addPhoto()` renders the card immediately (with a spinner).
3. `app.js` calls `electronAPI.processImage(filePath)` via IPC to `imageProcessor.js`.
4. Processed buffer (base64) is stored back in `appState.photos[i].processedBuffer`.
5. `PhotoGrid.updateThumbnail()` replaces the spinner with the processed image.
6. On print/export, `app.js` passes the base64 buffers to `printManager.js` via IPC.

### Layout Modes

The app has two mutually exclusive layout modes stored in `appState.layoutMode`:

- **`grid`** (default): Photos arranged in a configurable cols×rows grid on A4 paper. Each photo is 35mm×45mm. The `photo-list-section` is visible and the standard upload flow applies.
- **`aadhaar-card`**: Two slots (front/back) with draggable/resizable absolute positioning on the A4 page. Uses separate state (`aadhaarFront`, `aadhaarBack`, `aadhaarCardPositions`). The photo list section is hidden and replaced with dedicated front/back upload buttons.

Switching modes clears the current selection and resets the preview.

### Settings & Persistence

Settings are stored in `DataStore` (`settings.json` in `userData`). Key persisted fields: `shopName`, `pricePerPhoto`, `geminiApiKey`, `darkMode`, `layoutMode`, `layoutCols`, `layoutRows`, `showCutGuides`, `halfPage`, `printerName`, `aadhaarCardPositions`. The store deep-merges with defaults on load so new keys get their default values.

### Sharp & Native Dependencies

Sharp is a native dependency. In packaged builds, it lives in `app.asar.unpacked` because `asarUnpack` in `package.json` unpacks both `sharp` and `@img`. `imageProcessor.js` has a two-tier require: first tries `require('sharp')`, then falls back to `require(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp'))`.

### Security Notes

- `sandbox: false` in the main window's `webPreferences` is required so the preload script can use Node APIs.
- The CSP in `index.html` is strict: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`.
- All IPC handlers in `main.js` are wrapped in try-catch and return `{ success, error }` shaped objects.
