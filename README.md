# UI Inspector

A lightweight Chrome Extension for frontend QA. Click any element on a page, log what's wrong and how to fix it, tag severity, and export a structured JSON report.

## Install

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. Pin the extension from the puzzle-piece icon in the toolbar

## Usage

1. Navigate to any webpage you want to inspect
2. Click the **UI Inspector** icon in the toolbar
3. Click **Start inspecting** — your cursor becomes a crosshair
4. Hover over elements to highlight them, then click one to select it
5. A modal appears — describe the issue, suggest a fix, and set severity (Low / Medium / High / Critical)
6. Click **Save Issue** to log it
7. Use **Export JSON** in the popup footer to download all issues as `ui-inspector-export.json`
8. Use **Clear all** to reset

The popup shows a live issue count and the 3 most recent issues. A dark/light theme toggle is in the header.

## Tech Stack

- **Manifest V3** Chrome Extension
- **Vanilla JS** — no frameworks or libraries
- **CSS Variables** — light/dark theme with no flash on load
- Content script with DOM event listeners for element selection
- React Fiber traversal to detect component names (works on React apps)

## Coming Soon

- Severity filtering in the issue list
- Team export formats (Markdown, Linear import)