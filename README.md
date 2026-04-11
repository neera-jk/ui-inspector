# UI Inspector

A Chrome extension for frontend QA. Hover over any element on a page, click it, describe what's wrong, and export a structured report. Built for developers and QA engineers who want a faster way to document UI bugs without leaving the browser.

## What it does

- **Inspect mode** — hover to highlight elements, click to select
- **Issue logging** — describe the bug, suggest a fix, pick a severity (Low / Medium / High / Critical)
- **Screenshots** — auto-captures the selected element using html2canvas
- **Computed styles** — shows font, color, spacing, dimensions, etc. for the selected element
- **Sidebar panel** — lists all logged issues with expand/collapse detail view
- **Export** — download issues as JSON or CSV
- **Dark mode** — toggle from the popup, syncs across popup and page
- **React support** — detects the nearest React component name via fiber traversal
- **Persistent storage** — issues survive page reloads (stored in `chrome.storage.local`)

## Install

1. Clone this repo:
   ```
   git clone https://github.com/neera-jk/ui-inspector.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Turn on **Developer mode** (toggle in the top right)
4. Click **Load unpacked** → select the `ui-inspector` folder you just cloned
5. Pin the extension from the puzzle-piece icon in the toolbar so it's easy to access

That's it. No build step, no dependencies to install.

## How to use

1. Go to any webpage
2. Click the **UI Inspector** icon in your toolbar
3. Hit **Start inspecting** — your cursor turns into a crosshair
4. Hover over elements to see them highlighted, click one to select it
5. A modal pops up showing the element info (component name, selector, computed styles, screenshot)
6. Fill in what's wrong and how to fix it, pick a severity, and hit **Save Issue**
7. Open the **sidebar panel** (from the popup) to see all your logged issues
8. Export as JSON or CSV when you're done

You can also use the console API on any page where the extension is active:
- `inspectUI()` — start inspect mode
- `toggleSidebar()` — open/close the sidebar
- `viewIssues()` — print all issues to the console
- `clearIssues()` — wipe everything

## Project structure

```
manifest.json      — extension config (Manifest V3)
content.js         — main content script (inspect, modal, sidebar, storage)
content.css        — all injected styles (highlight, modal, sidebar, animations)
popup.html         — extension popup markup
popup.js           — popup logic (messaging, theme toggle)
popup.css          — popup styles
theme-init.js      — prevents dark mode flash on page load
html2canvas.min.js — screenshot library (bundled, no CDN)
```

## Built with

Vanilla JS, CSS custom properties, Chrome Extension Manifest V3. No frameworks, no build tools.