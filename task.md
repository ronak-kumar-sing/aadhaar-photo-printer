# Audit Fix Implementation Tasks

## Critical / Build-Breaking
- [/] BUILD-01: Update package.json for .ico icon references + generate .ico
- [ ] BUG-06: Check print result for success in app.js

## High Priority Bugs
- [ ] BUG-04: Fix loadRecentPhotos data type in app.js
- [ ] BUG-03: Add `copies` to DataStore allowedKeys
- [ ] BUG-02: Remove unused electron-store dependency
- [ ] BUG-01: Fix error handlers returning success: true in main.js
- [ ] BUG-05: Fix recent photo click in photoGrid.js
- [ ] BUG-07: Add darkMode to saveSettings payload

## Security
- [ ] SEC-02: Use safeStorage for API key encryption

## Build & Packaging
- [ ] BUILD-02: Better description in package.json
- [ ] BUILD-03: Remove unused playwright
- [ ] BUILD-04: Improve .gitignore
- [ ] BUILD-05: Add homepage/repository fields

## Code Quality
- [ ] CQ-03: Move fs require to top of main.js
- [ ] CQ-04: Remove duplicate exports comment in imageProcessor.js

## UX Improvements
- [ ] UX-05: Add confirmation dialog for Clear All
- [ ] UX-03: Add splash screen / loading overlay

## Missing Professional Features
- [ ] MISS-02: Add "About" dialog
- [ ] MISS-03: Add structured error logging (electron-log style)
- [ ] MISS-04: Add system tray icon

## General Improvements
- [ ] GEN-01: Use or remove dead estimateInkUsage code
- [ ] GEN-03: Add copies × photos overflow guard
