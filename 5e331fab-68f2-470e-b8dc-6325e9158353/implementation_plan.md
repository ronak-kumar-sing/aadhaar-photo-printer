# Aadhaar Photo Printer — Desktop Application

A standalone Windows desktop application for photo/print shop owners to easily print Aadhaar card photos on A4 pages.

---

## User Review Required

> [!IMPORTANT]
> **Technology Choice: Electron.js**
> I'm proposing to build this as an **Electron application** (HTML/CSS/JS wrapped as a native Windows app). This gives us:
> - A beautiful, modern UI using web technologies (HTML/CSS animations, glassmorphism, etc.)
> - Excellent image processing via **Sharp** (native C library, 40-50x faster than pure JS alternatives)
> - Built-in print support via `webContents.print()` with A4 page sizing
> - PDF export via `webContents.printToPDF()`
> - Packaged as a standalone `.exe` installer via **electron-builder**
>
> **Trade-off**: The packaged app will be ~150-200MB due to Chromium bundling. This is standard for Electron apps and acceptable for a desktop tool.

> [!WARNING]
> **Scope Consideration**: Some advanced features (face-detection-based auto-crop, red-eye removal) require ML models that significantly increase app size and complexity. I recommend:
> - **Phase 1 (this build)**: Smart crop with aspect ratio enforcement, EXIF-based auto-rotation, brightness/contrast auto-correction, manual crop adjustment
> - **Phase 2 (future)**: ML-based face detection auto-crop, red-eye removal
>
> This keeps the initial build focused and deliverable. Red-eye removal and face-detection can be added later with `face-api.js` or similar.

## Open Questions

> [!IMPORTANT]
> 1. **Photo size**: The standard Aadhaar photo is **35mm × 45mm** (3.5cm × 4.5cm). Should I also support **2×2 inch (51mm × 51mm)** passport photos, or stick to Aadhaar-only?
> 2. **Language**: You mentioned Hindi/English mix for error messages. Should the entire UI be bilingual (Hindi + English), or just error messages?
> 3. **Price defaults**: What should be the default price per photo for receipt generation? (Can be changed in settings)
> 4. **Installation**: Do you prefer a **portable .exe** (no install, just run) or an **NSIS installer** (creates Start Menu shortcut, uninstaller)? I recommend the installer approach for a professional feel.

---

## Proposed Changes

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Framework | Electron 34+ | Desktop app shell |
| UI | HTML5 + CSS3 + Vanilla JS | Modern, responsive interface |
| Image Processing | Sharp (libvips) | Resize, crop, rotate, brightness/contrast |
| Print Layout | HTML/CSS `@media print` + `@page` | Pixel-perfect A4 layouts |
| PDF Export | Electron `printToPDF()` | Digital delivery |
| Data Storage | JSON files (electron-store) | Settings, print history, customer data |
| Packaging | electron-builder | Standalone Windows .exe/installer |
| Icons/Fonts | Google Material Icons + Inter font (bundled) | Offline-capable modern UI |

---

### Project Structure

```
aadhaar-photo-printer/
├── package.json
├── electron-builder.yml          # Build/packaging config
├── src/
│   ├── main/
│   │   ├── main.js               # Electron main process
│   │   ├── preload.js            # Secure bridge (contextBridge)
│   │   ├── imageProcessor.js     # Sharp-based image processing
│   │   ├── printManager.js       # Print & PDF generation
│   │   ├── dataStore.js          # Settings, history, customer data
│   │   └── fileManager.js        # File operations, backup, recent photos
│   ├── renderer/
│   │   ├── index.html            # Main application page
│   │   ├── styles/
│   │   │   ├── main.css          # Core design system
│   │   │   ├── components.css    # Component styles
│   │   │   └── print.css         # Print-specific styles (@media print)
│   │   ├── scripts/
│   │   │   ├── app.js            # Main app controller
│   │   │   ├── photoGrid.js      # Photo grid/layout management
│   │   │   ├── preview.js        # A4 page preview renderer
│   │   │   ├── ui.js             # UI interactions, animations
│   │   │   └── receipts.js       # Receipt generation
│   │   └── assets/
│   │       ├── icons/            # App icons (bundled Material Icons subset)
│   │       └── fonts/            # Inter font files (bundled)
│   └── print/
│       └── printTemplate.html    # Hidden window for print rendering
├── resources/
│   └── icon.ico                  # App icon
└── build/                        # Build output
```

---

### Component 1: Main Process (Backend)

#### [NEW] `src/main/main.js`
- Create main Electron window (1200×800, min 1024×700)
- Register IPC handlers for all renderer-to-main communication
- Create hidden print window for A4 layout rendering
- Handle app lifecycle (single instance lock, graceful shutdown)
- Initialize data store on first launch

#### [NEW] `src/main/preload.js`
- Secure `contextBridge` API exposing:
  - `photoAPI`: processImage, getImageInfo, batchProcess
  - `printAPI`: print, printToPDF, getPrinters, getPageSetup
  - `fileAPI`: openFileDialog, saveFile, getRecentPhotos, backupPhotos
  - `storeAPI`: getSettings, setSettings, getHistory, addHistory
  - `customerAPI`: saveCustomer, searchCustomers, getRecent

#### [NEW] `src/main/imageProcessor.js`
- **`processImage(filePath, options)`**: Main processing pipeline:
  1. Read image with Sharp
  2. Auto-rotate based on EXIF metadata (`sharp.rotate()`)
  3. Extract metadata (dimensions, format, orientation)
  4. Resize/crop to target dimensions (35mm × 45mm at 300 DPI = 413 × 531px)
  5. Auto-correct brightness/contrast using `sharp.normalize()` + `sharp.modulate()`
  6. Output as high-quality JPEG buffer
- **`generateThumbnail(filePath)`**: Create small preview (200px wide)
- **`batchProcess(filePaths)`**: Process multiple images with progress reporting
- **`getImageInfo(filePath)`**: Return dimensions, format, file size

#### [NEW] `src/main/printManager.js`
- **`printPage(photos, options)`**: 
  1. Generate HTML layout with photos arranged in grid on A4
  2. Load into hidden BrowserWindow
  3. Call `webContents.print()` with options:
     - `pageSize: 'A4'`
     - `printBackground: true`
     - `margins: { marginType: 'custom', top: 10, bottom: 10, left: 10, right: 10 }`
  4. Quality presets map to DPI settings
- **`exportToPDF(photos, outputPath)`**: Use `webContents.printToPDF()`
- **`getPrinters()`**: Return list of system printers
- **`estimateInkUsage(photoCount)`**: Simple calculation based on photo coverage area

#### [NEW] `src/main/dataStore.js`
- Uses `electron-store` for persistent JSON storage
- Stores:
  - Shop settings (name, price per photo, default quality)
  - Daily print counters (date → count map)
  - Customer records (name, phone, date, photo count)
  - UI preferences (dark mode, language)
  
#### [NEW] `src/main/fileManager.js`
- **`saveToRecent(imagePath)`**: Copy processed photo to `%APPDATA%/AadhaarPhotoPrinter/recent/` (keep last 50)
- **`backupPhotos(photos)`**: Copy to `%USERPROFILE%/Documents/AadhaarPhotoPrinter/backup/YYYY-MM-DD/`
- **`getRecentPhotos()`**: List recent folder with thumbnails
- **`cleanupOldPhotos()`**: Auto-delete photos older than 30 days from recent

---

### Component 2: Renderer (Frontend UI)

#### [NEW] `src/renderer/index.html`
Single-page application with three main sections:
1. **Header Bar**: App title + shop name, dark mode toggle, settings gear
2. **Main Area** (3-column flow):
   - **Left Panel**: Upload zone (drag-drop + button) + photo thumbnails list
   - **Center Panel**: A4 page preview (live WYSIWYG)
   - **Right Panel**: Print controls + customer info + receipt
3. **Bottom Bar**: Daily print count, status messages

#### [NEW] `src/renderer/styles/main.css`
Design system with:
- **Color palette**: 
  - Primary: `#1565C0` (deep blue) → `#1E88E5` (bright blue)
  - Surface: `#FFFFFF` / Dark: `#1A1A2E`
  - Accent: `#00C853` (success green)
  - Warning: `#FF6D00`
- **Typography**: Inter font, base 16px, headings up to 24px
- **Spacing**: 8px base unit
- **Animations**: 
  - Upload zone pulse on drag-over
  - Photo slide-in on add
  - Success checkmark animation after print
  - Smooth transitions on all interactive elements
- **Dark mode**: CSS custom properties toggled via `data-theme="dark"`
- **Responsive**: Flexbox layout that adapts to different window sizes

#### [NEW] `src/renderer/styles/components.css`
- `.upload-zone`: Large dashed border area, drag-drop visual feedback
- `.photo-card`: Thumbnail with remove button, processing spinner
- `.a4-preview`: Scaled A4 page with grid of photos, shadow/border
- `.print-btn`: Extra-large green button with printer icon
- `.quality-selector`: 3 big toggle buttons (Draft/Standard/High)
- `.customer-form`: Simple name + phone input
- `.receipt-card`: Styled receipt preview
- `.progress-bar`: Animated progress indicator
- `.toast-notification`: Slide-in success/error messages
- `.modal`: Simple modal for settings/confirmation

#### [NEW] `src/renderer/styles/print.css`
```css
@media print {
  @page { size: A4; margin: 5mm; }
  /* Hide everything except the print grid */
  /* Photos arranged in precise mm-based grid */
}
```

#### [NEW] `src/renderer/scripts/app.js`
Main application controller:
- Initialize all modules on DOM ready
- Handle drag-and-drop events on upload zone
- Coordinate between photo grid, preview, and print modules
- Manage application state (loaded photos, settings, etc.)

#### [NEW] `src/renderer/scripts/photoGrid.js`
- Manage the list of loaded photos
- Handle adding/removing photos
- Display processing progress for each photo
- Show thumbnails with delete buttons

#### [NEW] `src/renderer/scripts/preview.js`
- Render scaled A4 page preview in the center panel
- Calculate optimal grid layout (rows × columns) based on photo count
- Show photos at correct aspect ratio with cut lines
- Update in real-time as photos are added/removed
- Support both multi-photo (8-12 per page) and single-photo layouts

#### [NEW] `src/renderer/scripts/ui.js`
- Dark mode toggle with smooth transition
- Settings modal (shop name, price, language)
- Toast notifications for success/error
- Success animation (confetti/checkmark) after printing
- Keyboard shortcuts (Ctrl+P to print, Ctrl+O to open files)

#### [NEW] `src/renderer/scripts/receipts.js`
- Generate receipt HTML with:
  - Shop name, date/time
  - Customer name (optional)
  - Number of photos × price per photo = total
  - Print counter for the day
- Print receipt option (small format)

---

### Component 3: Print Template

#### [NEW] `src/print/printTemplate.html`
- Hidden window HTML template for actual printing
- Uses precise CSS measurements (mm units) for photo placement
- Layout options:
  - **Grid mode**: 3 columns × 4 rows = 12 photos per A4 (with 3mm gaps)
  - **Grid mode**: 4 columns × 3 rows = 12 photos per A4 (landscape photos)
  - **Single mode**: 1 large photo centered
- Each photo cell: 35mm × 45mm with 1mm white border (cut guide)
- Registration marks at corners for accurate cutting

---

### Component 4: Configuration & Build

#### [NEW] `package.json`
```json
{
  "name": "aadhaar-photo-printer",
  "version": "1.0.0",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win"
  },
  "dependencies": {
    "sharp": "^0.33.x",
    "electron-store": "^10.x"
  },
  "devDependencies": {
    "electron": "^34.x",
    "electron-builder": "^25.x"
  }
}
```

#### [NEW] `electron-builder.yml`
- Target: NSIS installer (or portable)
- Windows x64 only
- App icon from `resources/icon.ico`
- Include Sharp native binaries in `app.asar.unpacked`
- File associations: .jpg, .jpeg, .png, .bmp

---

## UI Layout Mockup

```
┌────────────────────────────────────────────────────────────────────┐
│  📷 Aadhaar Photo Printer          [My Shop Name]    🌙  ⚙️      │
├──────────────┬─────────────────────────────┬───────────────────────┤
│              │                             │                       │
│  ┌────────┐  │    ┌─── A4 Page ─────────┐  │  🖨️ PRINT            │
│  │        │  │    │ ┌──┐ ┌──┐ ┌──┐ ┌──┐ │  │  [████████████████]  │
│  │  DROP  │  │    │ │📷│ │📷│ │📷│ │📷│ │  │                       │
│  │ PHOTOS │  │    │ └──┘ └──┘ └──┘ └──┘ │  │  Quality:            │
│  │  HERE  │  │    │ ┌──┐ ┌──┐ ┌──┐ ┌──┐ │  │  [Draft][Standard]   │
│  │        │  │    │ │📷│ │📷│ │📷│ │📷│ │  │  [High Quality]      │
│  └────────┘  │    │ └──┘ └──┘ └──┘ └──┘ │  │                       │
│              │    │ ┌──┐ ┌──┐ ┌──┐ ┌──┐ │  │  ── Customer ──      │
│  Recent:     │    │ │📷│ │📷│ │📷│ │📷│ │  │  Name: [________]    │
│  ┌──┐ ┌──┐  │    │ └──┘ └──┘ └──┘ └──┘ │  │  Phone: [________]   │
│  │📷│ │📷│  │    └─────────────────────┘  │                       │
│  └──┘ └──┘  │                             │  📄 Export PDF         │
│  ┌──┐ ┌──┐  │    Layout: [4x3 ▼] Photos  │  🧾 Print Receipt     │
│  │📷│ │📷│  │    per page: 12             │  💾 Backup Photos     │
│  └──┘ └──┘  │                             │                       │
├──────────────┴─────────────────────────────┴───────────────────────┤
│  📊 Today: 24 pages printed  │  Status: Ready  │  Ink: ~Medium    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Verification Plan

### Automated Tests
1. **Image Processing**: Run Sharp processing pipeline on sample JPG/PNG/BMP files → verify output dimensions match 413×531px
2. **Build**: Run `npm run build` → verify `.exe` is generated and launches on Windows 10
3. **Print Preview**: Load test photos → verify A4 preview renders correctly with proper spacing

### Manual Verification
1. **Drag & Drop**: Test dragging 1, 5, 12 photos from Explorer into the app
2. **Print**: Test printing to a physical printer (if available) or PDF printer
3. **PDF Export**: Generate PDF and verify photo sizes measure correctly
4. **Dark Mode**: Toggle dark mode and verify all elements are readable
5. **Settings**: Set shop name and price, close/reopen app → verify persistence
6. **Receipt**: Generate and print a receipt
7. **Edge Cases**: Test with very large photos (20MP), very small photos, corrupt files

### Performance Targets
- App launch: < 3 seconds
- Single photo processing: < 2 seconds
- Batch of 12 photos: < 10 seconds
- Print to PDF: < 5 seconds
