# 🔍 Aadhaar Photo Printer — Professional Electron Audit Report

**Audited on:** 2026-06-02  
**Target:** Windows x64 (electron-builder, NSIS)  
**Electron version:** ^33.4.0  
**Total source files reviewed:** 18  

---

## Overall Assessment

This is a **well-structured, security-conscious Electron application**. The main/renderer split with `contextIsolation: true` and whitelisted IPC channels is done correctly. The code quality is above average for a project of this scale. However, there are **several issues that could cause build failures, runtime crashes, and UX gaps** in a production Windows deployment.

---

## 🐛 1. BUGS & LOGICAL ERRORS

### BUG-01: `file:getRecent` error handler returns `success: true` on failure
**File:** [main.js:L306](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L300-L308)  
**Problem:** The `file:getRecent` catch block returns `{ success: true, photos: [] }` when the operation fails. The same pattern exists in `store:getDailyCount` (L363), `customer:getRecent` (L397), and `customer:search` (L407). This silently swallows errors and makes debugging impossible.  
**Fix:** Return `{ success: false, photos: [], error: error.message }` in catch blocks, or at minimum log a warning. Swallowing errors is acceptable only for truly non-critical paths, but these should still return `success: false`.

---

### BUG-02: Unused `electron-store` dependency
**File:** [package.json:L16](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/package.json#L16)  
**Problem:** `electron-store` v10 is listed as a dependency but is **never imported or used** anywhere in the codebase. The custom `DataStore` class uses raw `fs` instead. `electron-store` v10 is ESM-only and would cause import errors if accidentally loaded. This adds ~200KB+ to the packaged app for nothing.  
**Fix:** Remove `"electron-store": "^10.0.0"` from `dependencies`.

---

### BUG-03: `copies` setting not persisted in `setSettings` allowedKeys
**File:** [dataStore.js:L113-L118](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/dataStore.js#L113-L118)  
**Problem:** `app.js` saves `copies` in the settings payload (L154), but `dataStore.js` doesn't include `copies` in its `allowedKeys` array. The value is silently dropped and never persisted. Next app launch, copies resets to 1.  
**Fix:** Add `'copies'` to the `allowedKeys` array in `setSettings()` and add `copies: 1` to the `DEFAULTS` object.

---

### BUG-04: `loadRecentPhotos` expects array, receives object
**File:** [app.js:L720](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L718-L725)  
**Problem:** `api().getRecentPhotos()` returns `{ success: boolean, photos: Array }` (an object), but `loadRecentPhotos` passes the raw result to `PhotoGrid.renderRecentPhotos(list)`. If `success` is true, `list` is the entire response object `{success, photos}`, not the array.  
**Fix:** Change to `PhotoGrid.renderRecentPhotos(list?.photos || [])`.

---

### BUG-05: `handleRecentClick` creates File from thumbnail, not original
**File:** [photoGrid.js:L173-L206](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/photoGrid.js#L173-L206)  
**Problem:** When a user clicks a recent photo, the code `fetch(item.thumbnail)` retrieves the base64 thumbnail (which is 200px wide) and creates a File from it. Even though `file.path` is set to the original path, the File's content is the low-res thumbnail. If the original file was deleted from disk, `processImage(file.path)` will fail, and the fallback `processImageFromBuffer` will process the tiny thumbnail image, producing a blurry 413×531 photo upscaled from 200px.  
**Fix:** Use `processImage(item.path)` directly via IPC instead of creating a fake File object. Only fall back to thumbnail-based processing if the original path is missing.

---

### BUG-06: `print:execute` result not checked for success
**File:** [app.js:L505](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L490-L506)  
**Problem:** `await api().print(printPhotos, printOptions)` returns a result object with `{ success, error }`, but the code never checks `result.success`. Even if printing fails, the daily count is still incremented and the success animation plays.  
**Fix:** Check `const result = await api().print(...)` and throw if `!result.success`.

---

### BUG-07: `darkMode` persisted via `setSettings()` but not via `saveSettings()` flow
**File:** [app.js:L908-L913](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L908-L914)  
**Problem:** When toggling dark mode via the button, `api().setSettings({ darkMode: ... })` is called. But the `saveSettings()` function (triggered by the Settings modal) doesn't include `darkMode` in its payload (L143-L155). If the user saves settings, it won't overwrite `darkMode` — but if the DataStore deep-merges selectively, the key `darkMode` doesn't appear in the explicit payload, so it's preserved correctly. **This is actually safe due to partial merging**, but it creates a confusing code path.  
**Fix:** Include `darkMode: appState.settings.darkMode` in the `saveSettings()` payload for consistency.

---

## 🎨 2. UI/UX ISSUES

### UX-01: No window icon (.ico) for Windows
**File:** [main.js:L71](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L71)  
**Problem:** The BrowserWindow `icon` points to `icon.png`. On Windows, the taskbar and title bar icon require `.ico` format. A `.png` may display incorrectly or not at all on Windows.  
**Fix:** Convert `icon.png` to `icon.ico` (256×256, multi-resolution ICO) and use it for the window icon. Keep .png for macOS/Linux.

---

### UX-02: No custom titlebar — default Windows frame removed but not replaced
**File:** [main.js:L83-L84](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L83-L84)  
**Problem:** `Menu.setApplicationMenu(null)` removes the menu bar, but the app still uses the default Windows title bar frame. The header has `-webkit-app-region: drag` for custom titlebar behavior, but there are no minimize/maximize/close buttons rendered in the app UI. Users rely entirely on the OS title bar buttons, which is correct — but the drag region on the header conflicts with clicking header buttons on some Windows versions.  
**Fix:** Either make the header drag region more precise (avoid overlapping with buttons) or add a custom frameless window with custom close/minimize/maximize buttons.

---

### UX-03: No loading state during initial app startup
**Problem:** After the window shows (`ready-to-show`), the renderer starts loading settings, printers, daily counts, and recent photos — all asynchronously. During this time, the UI may flash or show stale data.  
**Fix:** Add a lightweight splash/loading overlay in `index.html` that hides after `DOMContentLoaded` initialization completes.

---

### UX-04: Receipt print uses `window.open()` popup which may be blocked
**File:** [receipts.js:L73](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/receipts.js#L73)  
**Problem:** `window.open('', '_blank', ...)` will not work in Electron with `contextIsolation: true` and `sandbox: false` unless explicitly allowed. The default behavior may vary between Electron versions.  
**Fix:** Use a hidden BrowserWindow (like printManager does) for receipt printing, or use `webContents.print()` directly on the receipt modal content.

---

### UX-05: No confirmation dialog before clearing all photos
**File:** [app.js:L421-L435](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L421-L435)  
**Problem:** "Clear All" immediately removes all photos without asking the user to confirm. If 20+ photos were loaded and enhanced, accidental clicks cause significant data loss.  
**Fix:** Add a confirmation dialog: `UIManager.showConfirmModal('Clear all photos?', handleClearAll)`.

---

## 🏗️ 3. CODE QUALITY

### CQ-01: Duplicated `escapeHTML` function in 3 files
**Files:** [printManager.js:L463](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/printManager.js#L463), [ui.js:L255](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/ui.js#L255), [receipts.js:L159](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/receipts.js#L159)  
**Problem:** Three different implementations of `escapeHTML` exist. The main process version is string-based (correct), while the renderer versions use DOM (`document.createElement('div')`) which is fine but inconsistent.  
**Fix:** In the renderer, consolidate into one shared utility. Not critical, but reduces maintenance burden.

---

### CQ-02: Duplicated `formatBytes` in 2 files
**Files:** [app.js:L52](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L52), [photoGrid.js:L278](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/photoGrid.js#L278)  
**Problem:** Identical `formatBytes()` is defined twice.  
**Fix:** Move to a shared utils module or have `photoGrid.js` use the one from `app.js` via `window`.

---

### CQ-03: Inline `require('fs')` inside IPC handlers
**File:** [main.js:L462-L466](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L462-L466)  
**Problem:** `const fs = require('fs')` appears inside `ai:whiteBalance`, `ai:sharpen`, and `ai:whitenBg` handlers — 3 times total. `fs` is already available at the top of other modules (imageProcessor, fileManager, etc.), but not imported at the top of `main.js`.  
**Fix:** Add `const fs = require('fs')` at the top of `main.js` alongside the other imports.

---

### CQ-04: Duplicated `Exports` section comment block
**File:** [imageProcessor.js:L506-L531](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/imageProcessor.js#L506-L531)  
**Problem:** There are two `// Exports` comment blocks — one at line 506 and another at line 529. The first one is above `rotateBase64Image` and is misleading.  
**Fix:** Remove the duplicate comment block at line 506.

---

### CQ-05: Heavy reliance on global `window.*` for inter-module communication
**Files:** [app.js:L1211-L1218](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L1210-L1218)  
**Problem:** Seven functions/objects are attached to `window` for cross-module access (`appState`, `handleRemovePhoto`, `handleFilesSelected`, `refreshPreview`, `updateProcessingStatus`, `updatePrintButton`, `updatePhotoCountBadge`). This makes dependencies implicit and hard to trace.  
**Fix:** This works for a vanilla JS app without a build system, so it's acceptable but documented. For the future, consider an event bus or module bundler.

---

## 🔒 4. SECURITY VULNERABILITIES

### SEC-01: `sandbox: false` weakens security
**File:** [main.js:L77](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L77)  
**Problem:** `sandbox: false` is set to allow the preload script to use Node APIs. While this is documented and understood, it means the preload has full Node access. If a vulnerability allows arbitrary code injection into the preload or if a dependency is compromised, the attacker has full system access.  
**Fix:** This is a known trade-off. Document it explicitly. Consider whether the preload truly needs Node APIs or if all logic can be moved into the main process with IPC.

---

### SEC-02: Gemini API key stored in plaintext JSON file
**File:** [dataStore.js:L30](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/dataStore.js#L30)  
**Problem:** The Gemini API key is stored as plain text in `settings.json` in the `userData` directory. Any process on the machine (or malware) can read it.  
**Fix:** Use Electron's `safeStorage` API to encrypt the API key before saving. `safeStorage.encryptString(key)` / `safeStorage.decryptString(buffer)`.

---

### SEC-03: CSP allows `'unsafe-inline'` for styles
**File:** [index.html:L6](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/index.html#L6)  
**Problem:** `style-src 'self' 'unsafe-inline'` allows inline styles, which could be exploited if an attacker can inject HTML content. Many inline styles are used in generated HTML (toast, preview).  
**Fix:** For a desktop app loading only local content, this is low risk but could be tightened by using CSS classes instead of inline styles. Alternatively, use nonces.

---

### SEC-04: No path traversal validation on file operations
**Files:** [fileManager.js:L308-L328](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/fileManager.js#L308-L328), [main.js:L160-L176](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/main.js#L160-L176)  
**Problem:** `processImage(filePath)` and `backupPhotos` accept file paths from the renderer without validating they're within expected directories. A compromised renderer could potentially read arbitrary files by passing paths like `/etc/passwd` or `C:\Windows\System32\...`.  
**Fix:** Validate that incoming file paths have expected extensions and are within user-accessible directories. The `sanitizeFileName` function exists but is only used for output filenames, not input path validation.

---

## ⚡ 5. PERFORMANCE ISSUES

### PERF-01: Sequential photo processing (no parallelism)
**File:** [app.js:L315-L385](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L315-L385)  
**Problem:** Photos are processed one-by-one in a `for` loop. Each photo requires an IPC roundtrip and Sharp processing. With 20 photos, this is noticeably slow.  
**Fix:** Process photos in parallel with a concurrency limit (e.g., 3 at a time using `Promise.all` with a pool). The `processImages` batch endpoint exists but is unused for file-based uploads.

---

### PERF-02: Synchronous `fs` calls in hot paths
**Files:** [imageProcessor.js:L72-L80](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/imageProcessor.js#L72-L80), [fileManager.js:L78](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/fileManager.js#L78), [dataStore.js:L270-L304](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/dataStore.js#L270-L304)  
**Problem:** `fs.existsSync`, `fs.readFileSync`, `fs.writeFileSync`, `fs.statSync` are used throughout the main process. These are synchronous and block the main process thread. While Sharp async calls dominate the processing time, the sync I/O adds up with many files.  
**Fix:** Use `fs.promises` (async versions) for all file operations except where synchronous loading is truly required (e.g., module initialization).

---

### PERF-03: Full image stored as base64 in renderer memory
**File:** [app.js:L351](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/scripts/app.js#L351)  
**Problem:** `photo.processedBuffer` stores the full base64-encoded JPEG (~100-300KB per photo) in renderer JS memory. With 50 photos and copies, this can consume 50MB+ of renderer heap. The same base64 is also duplicated in `photo.thumbnail` and `photo.originalBuffer`.  
**Fix:** Store only a reference (file path to temp file) and load on-demand. Or at minimum, don't duplicate `processedBuffer` into `originalBuffer` (L352) — keep a separate smaller thumbnail.

---

### PERF-04: `loadRecentPhotos` generates thumbnails synchronously for all recent files
**File:** [fileManager.js:L92-L143](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/fileManager.js#L92-L143)  
**Problem:** `getRecentPhotos` reads every file in the recent directory, runs Sharp on each to generate a 200px thumbnail, converts to base64, and sends everything over IPC. With 50 recent files, this can take several seconds and blocks the main process.  
**Fix:** Cache thumbnails on disk alongside the originals (e.g., `photo.thumb.jpg`). Only regenerate if the thumbnail is missing.

---

## 📦 6. BUILD & PACKAGING ISSUES

> [!CAUTION]
> Issues marked with 🚨 may cause `electron-builder --win --x64` to **FAIL** or produce a **broken installer**.

### 🚨 BUILD-01: Missing Windows `.ico` file — installer icon will fail
**File:** [package.json:L42-L48](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/package.json#L42-L48)  
**Problem:** `"icon": "resources/icon.png"` and `"installerIcon": "resources/icon.png"` — NSIS on Windows **requires `.ico` format** for the installer icon and uninstaller icon. electron-builder may accept `.png` and auto-convert for the app icon, but `installerIcon` and `uninstallerIcon` in the `nsis` section **require `.ico` files**. This will cause a build warning or failure.  
**Fix:** Create `resources/icon.ico` (multi-resolution: 16, 32, 48, 64, 128, 256px). Update:
```json
"win": { "icon": "resources/icon.ico" },
"nsis": {
  "installerIcon": "resources/icon.ico",
  "uninstallerIcon": "resources/icon.ico"
}
```

---

### BUILD-02: `description` field too generic for Windows installer
**File:** [package.json:L4](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/package.json#L4)  
**Problem:** `"description": "Simple Aadhaar card photo printer for print shops"` — the word "Simple" is unprofessional for a production installer description shown in Windows Add/Remove Programs.  
**Fix:** `"description": "Professional Aadhaar & Passport photo printing solution for photo studios"`

---

### BUILD-03: Unused `playwright` devDependency increases install time
**File:** [package.json:L22](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/package.json#L22)  
**Problem:** `playwright` is listed in devDependencies but there are no tests. It downloads browser binaries (~400MB) on `npm install`.  
**Fix:** Remove `"playwright": "^1.60.0"` or add actual tests.

---

### BUILD-04: `.gitignore` is minimal — build artifacts may leak
**File:** [.gitignore](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/.gitignore)  
**Problem:** Only `node_modules` is ignored. The `dist/`, `build/`, and `5e331fab-...` directories (a UUID-named folder that appears to be a temp/artifact) are not ignored.  
**Fix:** Add `dist/`, `build/`, `*.exe`, `*.msi`, `.env`, and the UUID folder to `.gitignore`.

---

### BUILD-05: Missing `homepage` and `repository` fields
**File:** [package.json](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/package.json)  
**Problem:** electron-builder uses these for auto-updater and metadata. Missing them produces warnings.  
**Fix:** Add `"homepage"` and `"repository"` fields to `package.json`.

---

## 🧩 7. MISSING PROFESSIONAL FEATURES

### MISS-01: No auto-updater
**Problem:** There is no `electron-updater` setup. Users must manually download and install updates.  
**Fix:** Add `electron-updater` with a GitHub Releases or S3 backend. Register `autoUpdater.checkForUpdatesAndNotify()` in the main process `app.whenReady()`.

---

### MISS-02: No "About" dialog
**Problem:** There is no way for users to check the app version, license, or credits. Standard for any production desktop app.  
**Fix:** Add an "About" button in settings or header. Show `app.getVersion()`, `app.getName()`, and Electron/Node versions.

---

### MISS-03: No crash reporter or structured error logging
**Problem:** Errors are only `console.error`'d. There is no file-based log, no crash reporter, and no way to diagnose issues on customer machines.  
**Fix:** Use `electron-log` to write logs to `userData/logs/`. Enable `crashReporter.start()` for native crash reports.

---

### MISS-04: No system tray icon
**Problem:** When the app is running, it only appears in the taskbar. A tray icon would allow quick access and is expected for print-shop tools that run all day.  
**Fix:** Add a `Tray` with a context menu (show window, quit). Use the `.ico` icon.

---

## 🧹 8. GENERAL IMPROVEMENTS

### GEN-01: `estimateInkUsage` is dead code
**File:** [printManager.js:L457-L461](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/printManager.js#L457-L461)  
**Problem:** `estimateInkUsage` is exported but never called anywhere. The footer ink display in `app.js` uses a naive formula instead.  
**Fix:** Either use the `estimateInkUsage` function from printManager or remove it.

---

### GEN-02: `generateThumbnail` is exported but only used internally
**File:** [imageProcessor.js:L251-L268](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/main/imageProcessor.js#L251-L268)  
**Problem:** `generateThumbnail` is exported and listed in preload imports in main.js (line 16), but never exposed via IPC. It's only used by `fileManager.js` internally via `require('./imageProcessor')`.  
**Fix:** Remove from the main.js import to avoid confusion, or expose via IPC if needed.

---

### GEN-03: No input validation on `input-copies` overflow
**File:** [index.html:L239](file:///Users/ronakkumar/Desktop/aadhaar-photo-printer/src/renderer/index.html#L239)  
**Problem:** The copies input allows `max="100"`. Combined with 50 photos, this creates 5,000 photo slots — each with a base64 buffer in memory. This would crash the app or produce an absurdly large print job.  
**Fix:** Add a sanity check: `const totalPhotos = appState.photos.length * copies; if (totalPhotos > 200) { warn and cap }`.

---

---

## 📋 PRIORITY TABLE

| # | Issue | Category | Priority | Build-Breaking? |
|---|-------|----------|----------|-----------------|
| 1 | BUILD-01: Missing `.ico` file for NSIS installer | 📦 Build | **🔴 High** | 🚨 **Yes** |
| 2 | BUG-06: Print result not checked for success | 🐛 Bug | **🔴 High** | No |
| 3 | BUG-04: `loadRecentPhotos` passes wrong data type | 🐛 Bug | **🔴 High** | No |
| 4 | BUG-03: `copies` not in DataStore allowedKeys | 🐛 Bug | **🔴 High** | No |
| 5 | SEC-02: API key stored in plaintext | 🔒 Security | **🔴 High** | No |
| 6 | BUG-02: Unused `electron-store` adds bloat/risk | 🐛 Bug | **🟡 Medium** | No |
| 7 | SEC-04: No path validation on file operations | 🔒 Security | **🟡 Medium** | No |
| 8 | BUG-05: Recent photo click uses low-res thumbnail | 🐛 Bug | **🟡 Medium** | No |
| 9 | BUG-01: Error handlers return `success: true` | 🐛 Bug | **🟡 Medium** | No |
| 10 | UX-01: No `.ico` for BrowserWindow on Windows | 🎨 UX | **🟡 Medium** | No |
| 11 | PERF-01: Sequential photo processing | ⚡ Perf | **🟡 Medium** | No |
| 12 | PERF-02: Synchronous `fs` calls in main process | ⚡ Perf | **🟡 Medium** | No |
| 13 | PERF-03: Full base64 images in renderer memory | ⚡ Perf | **🟡 Medium** | No |
| 14 | UX-04: Receipt popup may be blocked | 🎨 UX | **🟡 Medium** | No |
| 15 | UX-05: No confirmation for Clear All | 🎨 UX | **🟡 Medium** | No |
| 16 | BUILD-03: Unused `playwright` devDep | 📦 Build | **🟡 Medium** | No |
| 17 | BUILD-04: Minimal `.gitignore` | 📦 Build | **🟡 Medium** | No |
| 18 | MISS-03: No error logging to file | 🧩 Missing | **🟡 Medium** | No |
| 19 | MISS-01: No auto-updater | 🧩 Missing | **🟡 Medium** | No |
| 20 | SEC-01: `sandbox: false` | 🔒 Security | **🟢 Low** | No |
| 21 | SEC-03: `'unsafe-inline'` in CSP | 🔒 Security | **🟢 Low** | No |
| 22 | CQ-01: Duplicated `escapeHTML` | 🏗️ Code | **🟢 Low** | No |
| 23 | CQ-02: Duplicated `formatBytes` | 🏗️ Code | **🟢 Low** | No |
| 24 | CQ-03: Inline `require('fs')` in handlers | 🏗️ Code | **🟢 Low** | No |
| 25 | CQ-04: Duplicate "Exports" comment block | 🏗️ Code | **🟢 Low** | No |
| 26 | CQ-05: Global `window.*` for cross-module calls | 🏗️ Code | **🟢 Low** | No |
| 27 | BUG-07: `darkMode` missing from `saveSettings` payload | 🐛 Bug | **🟢 Low** | No |
| 28 | UX-02: No custom titlebar controls | 🎨 UX | **🟢 Low** | No |
| 29 | UX-03: No splash screen on startup | 🎨 UX | **🟢 Low** | No |
| 30 | PERF-04: Thumbnail generation not cached | ⚡ Perf | **🟢 Low** | No |
| 31 | BUILD-02: Generic description | 📦 Build | **🟢 Low** | No |
| 32 | BUILD-05: Missing `homepage`/`repository` | 📦 Build | **🟢 Low** | No |
| 33 | MISS-02: No "About" dialog | 🧩 Missing | **🟢 Low** | No |
| 34 | MISS-04: No system tray icon | 🧩 Missing | **🟢 Low** | No |
| 35 | GEN-01: Dead `estimateInkUsage` code | 🧹 Cleanup | **🟢 Low** | No |
| 36 | GEN-02: Unused `generateThumbnail` import | 🧹 Cleanup | **🟢 Low** | No |
| 37 | GEN-03: No copies × photos overflow guard | 🧹 Cleanup | **🟢 Low** | No |

---

## 🚨 Build-Failure Summary

> [!CAUTION]
> **1 issue will likely cause the build or installer to fail:**
> 
> **BUILD-01**: The NSIS `installerIcon` and `uninstallerIcon` fields reference `.png` files. NSIS requires `.ico` format. electron-builder **may auto-convert the app icon** from PNG, but the NSIS-specific fields do not get auto-converted and will cause a build error or produce an installer with a missing/broken icon.
> 
> **Action required**: Create `resources/icon.ico` before running `npm run build`.

---

## ✅ What's Done Well

| Aspect | Assessment |
|--------|-----------|
| Security model | ✅ `contextIsolation: true`, `nodeIntegration: false`, whitelisted IPC channels |
| Error handling | ✅ Every IPC handler wrapped in try-catch with `{ success, error }` responses |
| Single instance lock | ✅ Properly enforces one instance with window focus on second launch |
| Preload script | ✅ Clean `safeInvoke` / `safeOn` pattern with channel whitelists |
| Sharp loading | ✅ Two-tier require with asar-unpacked fallback |
| Data persistence | ✅ Atomic write-to-temp-then-rename for crash safety |
| AI integration | ✅ Fully optional with graceful offline fallback |
| HTML escaping | ✅ Used consistently in print HTML generation |
| Accessibility | ✅ ARIA roles, labels, keyboard focus rings, live regions |
| Code documentation | ✅ JSDoc on all public functions, comprehensive CLAUDE.md |
