/**
 * UI Inspector — Content Script
 *
 * Injected into every page by the Chrome extension. Provides:
 *  1. Inspect mode — hover to highlight elements, click to open issue modal
 *  2. Issue modal — log a bug with description, severity, screenshot, computed styles
 *  3. Sidebar panel — view, expand, and export all logged issues
 *  4. Persistence — issues stored in chrome.storage.local (survives page reloads)
 *  5. Message API — popup communicates via chrome.runtime messages
 */
(() => {
    "use strict";

    // Prevent double injection (manifest + popup fallback can both inject)
    if (window.__uiInspectorLoaded) return;
    window.__uiInspectorLoaded = true;

    /* ══════════════════════════════════════════════════════
       State
       ══════════════════════════════════════════════════════ */

    let isInspectMode = false;
    let issueList = [];

    // Highlight overlay (used instead of modifying host element classes)
    let lastHighlighted = null;
    let highlightOverlay = null;

    // Sidebar
    let isSidebarVisible = false;
    let sidebarEl = null;
    let sidebarClosing = false;

    // Modal
    let modalClosing = false;

    /* ══════════════════════════════════════════════════════
       Storage (chrome.storage.local)
       ══════════════════════════════════════════════════════ */

    /**
     * Loads issues from chrome.storage.local into memory.
     * On first run, migrates any leftover localStorage data.
     */
    function loadIssues(callback) {
        chrome.storage.local.get("ui-inspector-issues", (result) => {
            try {
                const data = result["ui-inspector-issues"];
                if (Array.isArray(data) && data.length > 0) {
                    issueList = data;
                } else {
                    migrateFromLocalStorage();
                }
            } catch (e) {
                issueList = [];
            }
            if (typeof callback === "function") callback();
        });
    }

    /** One-time migration: moves issues from localStorage → chrome.storage.local */
    function migrateFromLocalStorage() {
        try {
            const raw = localStorage.getItem("ui-inspector-issues");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    issueList = parsed;
                    localStorage.removeItem("ui-inspector-issues");
                    chrome.storage.local.set({ "ui-inspector-issues": issueList });
                    console.log("[UI Inspector] Migrated", issueList.length, "issues from localStorage");
                    return;
                }
            }
        } catch (e) { /* ignore */ }
        issueList = [];
    }

    /** Persists the in-memory issueList to chrome.storage.local */
    function saveIssues(callback) {
        chrome.storage.local.set({ "ui-inspector-issues": issueList }, () => {
            if (chrome.runtime.lastError) {
                console.warn("[UI Inspector] Failed to save issues:", chrome.runtime.lastError.message);
            }
            if (typeof callback === "function") callback();
        });
    }

    /** Clears all issues from memory and storage */
    function clearIssues(callback) {
        issueList = [];
        chrome.storage.local.remove("ui-inspector-issues", () => {
            console.log("[UI Inspector] All issues cleared.");
            if (typeof callback === "function") callback();
        });
    }

    /* ══════════════════════════════════════════════════════
       Utilities
       ══════════════════════════════════════════════════════ */

    /** Escapes HTML special characters to prevent XSS when building innerHTML */
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /** Triggers a file download in the browser */
    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /* ══════════════════════════════════════════════════════
       Element Analysis
       ══════════════════════════════════════════════════════ */

    /** CSS properties captured for each inspected element */
    const STYLE_PROPS = [
        "font-size", "font-weight", "color", "background-color",
        "border", "border-radius", "padding", "margin",
        "opacity", "box-shadow", "width", "height",
        "display", "line-height", "letter-spacing",
    ];

    /**
     * Finds the nearest React component name for an element.
     * Checks data-component attribute first, then React fiber internals.
     */
    function findComponentInfo(element) {
        if (!element) return "Unknown";

        // 1. Check data-component attribute
        const dataComp = element.getAttribute && element.getAttribute("data-component");
        if (dataComp) return dataComp;

        // 2. Check React fiber on the element itself
        const name = getReactComponentName(element);
        if (name) return name;

        // 3. Walk up ancestors looking for data-component or fiber
        let ancestor = element.parentElement;
        let levels = 0;
        while (ancestor && levels < 20) {
            const ancestorData = ancestor.getAttribute && ancestor.getAttribute("data-component");
            if (ancestorData) return ancestorData;

            const ancestorName = getReactComponentName(ancestor);
            if (ancestorName) return ancestorName;

            ancestor = ancestor.parentElement;
            levels++;
        }

        return "Unknown";
    }

    /** Extracts the React component name from an element's fiber, if present */
    function getReactComponentName(el) {
        const fiberKey = Object.keys(el).find(
            (key) => key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")
        );
        if (!fiberKey) return null;

        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth < 20) {
            if (fiber.elementType && typeof fiber.elementType.name === "string") {
                return fiber.elementType.name;
            }
            if (fiber.type && typeof fiber.type.name === "string") {
                return fiber.type.name;
            }
            fiber = fiber.return;
            depth++;
        }
        return null;
    }

    /**
     * Builds a 3-level parent hierarchy string in outside-in order.
     * Example: "section.main > div.container > article.card"
     */
    function getParentHierarchy(element) {
        const parts = [];
        let current = element.parentElement;
        let levels = 0;
        while (current && levels < 3 && current !== document.body && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const cls = current.classList && current.classList.length > 0 ? "." + current.classList[0] : "";
            parts.push(tag + cls);
            current = current.parentElement;
            levels++;
        }
        return parts.reverse().join(" > ");
    }

    /**
     * Builds a unique CSS selector path from the element up to the nearest ID or body.
     * Uses CSS.escape() to handle special characters in IDs and class names.
     */
    function getCssSelector(element) {
        if (!element || element === document.body || element === document.documentElement) return "";
        const segments = [];
        let current = element;
        let depth = 0;

        while (current && current !== document.body && current !== document.documentElement && depth < 10) {
            if (current.id) {
                segments.push("#" + CSS.escape(current.id));
                break;
            }
            const tag = current.tagName.toLowerCase();
            const cls = current.classList && current.classList.length > 0
                ? "." + CSS.escape(current.classList[0])
                : "";
            let nth = "";
            if (current.parentElement) {
                const idx = Array.from(current.parentElement.children).indexOf(current) + 1;
                nth = ":nth-child(" + idx + ")";
            }
            segments.push(tag + cls + nth);
            current = current.parentElement;
            depth++;
        }
        return segments.reverse().join(" > ");
    }

    /**
     * Collects all relevant data about the clicked element:
     * tag, classes, ID, text, page, hierarchy, component, selector, and computed styles.
     */
    function collectElementData(element) {
        const computed = window.getComputedStyle(element);
        const computedStyles = {};
        STYLE_PROPS.forEach((p) => { computedStyles[p] = computed.getPropertyValue(p); });

        return {
            tagName: element.tagName.toLowerCase(),
            id: element.id || "",
            className: element.getAttribute("class") || "",
            innerText: (element.innerText || "").substring(0, 50),
            page: window.location.pathname,
            hierarchy: getParentHierarchy(element),
            component: findComponentInfo(element),
            selector: getCssSelector(element),
            computedStyles,
        };
    }

    /* ══════════════════════════════════════════════════════
       Inspect Mode (hover highlight + click to log)
       ══════════════════════════════════════════════════════ */

    function enableInspectMode() {
        isInspectMode = true;
        document.addEventListener("mouseover", onMouseOver, false);
        document.addEventListener("mouseout", onMouseOut, false);
        document.addEventListener("click", onClick, true);
        document.body.style.cursor = "crosshair";
    }

    function disableInspectMode() {
        isInspectMode = false;
        document.removeEventListener("mouseover", onMouseOver, false);
        document.removeEventListener("mouseout", onMouseOut, false);
        document.removeEventListener("click", onClick, true);
        document.body.style.cursor = "";
        clearHighlight();
    }

    /** Shows a red overlay on the hovered element (without modifying its DOM classes) */
    function onMouseOver(e) {
        const target = e.target;
        if (target === document.body || target === document.documentElement) return;
        if (lastHighlighted === target) return;

        lastHighlighted = target;
        showHighlightOverlay(target);
    }

    /** Removes the highlight when the cursor leaves the element */
    function onMouseOut(e) {
        if (lastHighlighted === e.target) {
            clearHighlight();
        }
    }

    /** Creates a positioned overlay div that visually highlights the target element */
    function showHighlightOverlay(el) {
        removeHighlightOverlay();
        const rect = el.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.className = "ui-inspector-highlight";
        overlay.style.cssText =
            "position:fixed;pointer-events:none;z-index:2147483646;"
            + "top:" + rect.top + "px;left:" + rect.left + "px;"
            + "width:" + rect.width + "px;height:" + rect.height + "px;";
        document.body.appendChild(overlay);
        highlightOverlay = overlay;
    }

    /** Removes the highlight overlay from the DOM */
    function removeHighlightOverlay() {
        if (highlightOverlay && highlightOverlay.parentNode) {
            highlightOverlay.parentNode.removeChild(highlightOverlay);
        }
        highlightOverlay = null;
    }

    /** Clears both the tracked element reference and the overlay */
    function clearHighlight() {
        lastHighlighted = null;
        removeHighlightOverlay();
    }

    /** Handles click during inspect mode: collects element data and opens the issue modal */
    function onClick(e) {
        e.preventDefault();
        e.stopPropagation();

        const element = e.target;
        clearHighlight();

        const elementData = collectElementData(element);
        disableInspectMode();
        showInspectorModal(elementData, element);
    }

    /* ══════════════════════════════════════════════════════
       Issue Modal
       ══════════════════════════════════════════════════════ */

    /** Creates the modal backdrop, applies theme, and delegates to the builder */
    function showInspectorModal(elementData, targetElement) {
        const backdrop = document.createElement("div");
        backdrop.className = "ui-inspector-modal";
        backdrop.setAttribute("role", "dialog");
        backdrop.setAttribute("aria-modal", "true");
        backdrop.setAttribute("aria-labelledby", "ui-inspector-modal-title");

        chrome.storage.local.get("ui-inspector-theme", (result) => {
            if (result["ui-inspector-theme"] === "dark") {
                backdrop.setAttribute("data-theme", "dark");
            }
            buildAndMountModal(backdrop, elementData, targetElement);
        });
    }

    /** Builds all modal content, wires up event handlers, and appends to the DOM */
    function buildAndMountModal(backdrop, elementData, targetElement) {
        let selectedSeverity = "Medium";

        // ── Modal HTML ──
        backdrop.innerHTML = `
            <div class="ui-inspector-card">
                <div class="ui-inspector-header">
                    <h2 id="ui-inspector-modal-title">Log Issue</h2>
                    <button class="ui-inspector-close-btn" data-action="close">\u2715</button>
                </div>

                <div class="ui-inspector-info">
                    <span><strong>Component:</strong> ${escapeHtml(elementData.component)}</span>
                    <span><strong>Page:</strong> ${escapeHtml(elementData.page)}</span>
                    <span><strong>Element:</strong> &lt;${escapeHtml(elementData.tagName)}&gt;</span>
                    <span><strong>Selector:</strong> <code style="font-size:11px;word-break:break-all;">${escapeHtml(elementData.selector)}</code></span>
                    <div id="ui-inspector-screenshot-wrap" style="margin-top:8px;"></div>
                </div>

                <details class="ui-inspector-styles-details">
                    <summary class="ui-inspector-styles-summary">Computed Styles</summary>
                    <div class="ui-inspector-styles-grid" id="ui-inspector-styles-grid"></div>
                </details>

                <label class="ui-inspector-label">What is wrong?</label>
                <textarea class="ui-inspector-textarea" id="ui-inspector-what" placeholder="Describe the issue..."></textarea>

                <label class="ui-inspector-label">How should this be fixed?</label>
                <textarea class="ui-inspector-textarea" id="ui-inspector-how" placeholder="Describe the fix..."></textarea>

                <label class="ui-inspector-label">Severity</label>
                <div class="ui-inspector-severity-row">
                    <button class="ui-inspector-severity-btn" data-severity="Low"><span>Low</span><span></span></button>
                    <button class="ui-inspector-severity-btn selected-medium" data-severity="Medium"><span>Medium</span><span></span></button>
                    <button class="ui-inspector-severity-btn" data-severity="High"><span>High</span><span></span></button>
                    <button class="ui-inspector-severity-btn" data-severity="Critical"><span>Critical</span><span></span></button>
                </div>

                <button class="ui-inspector-save-btn" data-action="save">Save Issue</button>
            </div>
        `;

        // ── Populate computed styles grid ──
        const stylesGrid = backdrop.querySelector("#ui-inspector-styles-grid");
        if (stylesGrid && elementData.computedStyles) {
            Object.entries(elementData.computedStyles).forEach(([prop, val]) => {
                const row = document.createElement("div");
                row.className = "ui-inspector-styles-row";
                row.innerHTML =
                    '<span class="ui-inspector-styles-prop">' + escapeHtml(prop) + '</span>'
                    + '<span class="ui-inspector-styles-val">' + escapeHtml(val) + '</span>';
                stylesGrid.appendChild(row);
            });
        }

        // ── Severity selection (only one active at a time) ──
        const severityRow = backdrop.querySelector(".ui-inspector-severity-row");
        severityRow.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-severity]");
            if (!btn) return;
            selectedSeverity = btn.getAttribute("data-severity");
            severityRow.querySelectorAll(".ui-inspector-severity-btn").forEach((b) => {
                b.className = "ui-inspector-severity-btn";
            });
            btn.classList.add("selected-" + selectedSeverity.toLowerCase());
        });

        // ── Close modal (with animated exit) ──
        function closeModal() {
            if (modalClosing) return;

            // Confirm if user has typed something
            const whatVal = (backdrop.querySelector("#ui-inspector-what") || {}).value || "";
            const howVal = (backdrop.querySelector("#ui-inspector-how") || {}).value || "";
            if (whatVal.trim() || howVal.trim()) {
                if (!confirm("You have unsaved changes. Discard this issue?")) return;
            }

            modalClosing = true;
            const card = backdrop.querySelector(".ui-inspector-card");
            if (card) card.style.animation = "uiModalCardOut 0.25s ease forwards";
            backdrop.style.animation = "uiModalBackdropOut 0.25s ease forwards";

            setTimeout(() => {
                modalClosing = false;
                document.removeEventListener("keydown", onKeyDown, true);
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                enableInspectMode();
            }, 250);
        }

        // ── Keyboard: Escape to close, Tab to trap focus ──
        function onKeyDown(e) {
            if (e.key === "Escape") {
                closeModal();
                return;
            }
            if (e.key === "Tab") {
                const card = backdrop.querySelector(".ui-inspector-card");
                if (!card) return;
                const focusable = card.querySelectorAll('button, textarea, input, [tabindex]:not([tabindex="-1"])');
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
        document.addEventListener("keydown", onKeyDown, true);

        // ── Close handlers ──
        backdrop.querySelector("[data-action='close']").addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal();
        });

        // ── Save issue ──
        backdrop.querySelector("[data-action='save']").addEventListener("click", () => {
            const whatField = backdrop.querySelector("#ui-inspector-what");
            const howField = backdrop.querySelector("#ui-inspector-how");
            const whatValue = whatField.value.trim();
            const howValue = howField.value.trim();

            // Validate required fields
            if (!whatValue) { whatField.style.borderColor = "#ef4444"; whatField.focus(); return; }
            if (!howValue) { howField.style.borderColor = "#ef4444"; howField.focus(); return; }

            // Build the issue object
            const issue = {
                id: crypto.randomUUID(),
                component: elementData.component,
                page: elementData.page,
                element: elementData.tagName,
                classes: elementData.className,
                id_attr: elementData.id,
                text: elementData.innerText,
                hierarchy: elementData.hierarchy,
                selector: elementData.selector,
                computedStyles: elementData.computedStyles,
                screenshot: backdrop.__screenshotDataUrl || "",
                whatIsWrong: whatValue,
                howToFix: howValue,
                severity: selectedSeverity,
                timestamp: new Date().toISOString(),
            };

            issueList.push(issue);
            saveIssues();

            // Animate out and clean up
            modalClosing = true;
            const card = backdrop.querySelector(".ui-inspector-card");
            if (card) card.style.animation = "uiModalCardOut 0.25s ease forwards";
            backdrop.style.animation = "uiModalBackdropOut 0.25s ease forwards";

            setTimeout(() => {
                modalClosing = false;
                document.removeEventListener("keydown", onKeyDown, true);
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                renderSidebarIssues();
                enableInspectMode();
            }, 250);
        });

        // ── Mount modal ──
        document.body.appendChild(backdrop);

        // ── Screenshot capture (skips elements larger than 2000x2000) ──
        if (targetElement && typeof html2canvas === "function") {
            const rect = targetElement.getBoundingClientRect();

            if (rect.width > 2000 || rect.height > 2000) {
                console.warn(
                    "[UI Inspector] Element too large for screenshot ("
                    + Math.round(rect.width) + "\u00d7" + Math.round(rect.height)
                    + "), skipping capture."
                );
            } else {
                html2canvas(targetElement, { scale: 1, useCORS: true, logging: false })
                    .then((canvas) => {
                        const dataUrl = canvas.toDataURL("image/png");
                        backdrop.__screenshotDataUrl = dataUrl;
                        const wrap = backdrop.querySelector("#ui-inspector-screenshot-wrap");
                        if (wrap) {
                            const img = document.createElement("img");
                            img.src = dataUrl;
                            img.style.cssText = "max-width:100%;border-radius:6px;border:1px solid var(--ui-border);margin-top:4px;";
                            wrap.appendChild(img);
                        }
                    })
                    .catch((err) => {
                        console.warn("[UI Inspector] Screenshot capture failed:", err.message || err);
                    });
            }
        }
    }

    /* ══════════════════════════════════════════════════════
       Sidebar Panel
       ══════════════════════════════════════════════════════ */

    function showSidebar() {
        if (sidebarEl || sidebarClosing) return;
        isSidebarVisible = true;

        sidebarEl = document.createElement("div");
        sidebarEl.className = "ui-inspector-sidebar";
        sidebarEl.setAttribute("role", "complementary");
        sidebarEl.setAttribute("aria-label", "UI Inspector issues panel");

        chrome.storage.local.get("ui-inspector-theme", (result) => {
            if (result["ui-inspector-theme"] === "dark") {
                sidebarEl.setAttribute("data-theme", "dark");
            }

            sidebarEl.innerHTML =
                '<div class="ui-inspector-sb-header">'
                +   '<span class="ui-inspector-sb-title">UI Inspector</span>'
                +   '<span class="ui-inspector-sb-count" id="ui-inspector-sb-count">'
                +       issueList.length + " issues"
                +   '</span>'
                +   '<button class="ui-inspector-sb-close" id="ui-inspector-sb-close">\u2715</button>'
                + '</div>'
                + '<div class="ui-inspector-sb-body" id="ui-inspector-sb-body"></div>'
                + '<div class="ui-inspector-sb-footer">'
                +   '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-json">JSON</button>'
                +   '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-csv">CSV</button>'
                +   '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-clear">Clear</button>'
                + '</div>';

            document.body.appendChild(sidebarEl);
            renderSidebarIssues();

            // ── Sidebar event handlers ──

            sidebarEl.querySelector("#ui-inspector-sb-close").addEventListener("click", hideSidebar);

            sidebarEl.querySelector("#ui-inspector-sb-json").addEventListener("click", () => {
                downloadFile(JSON.stringify(issueList, null, 2), "ui-inspector-export.json", "application/json");
            });

            sidebarEl.querySelector("#ui-inspector-sb-csv").addEventListener("click", () => {
                const headers = ["id", "severity", "whatIsWrong", "howToFix", "component", "page", "element", "timestamp"];
                const rows = [headers.join(",")];
                issueList.forEach((issue) => {
                    const row = headers.map((h) => {
                        const val = (issue[h] || "").toString().replace(/"/g, '""');
                        return '"' + val + '"';
                    });
                    rows.push(row.join(","));
                });
                downloadFile(rows.join("\n"), "ui-inspector-export.csv", "text/csv");
            });

            sidebarEl.querySelector("#ui-inspector-sb-clear").addEventListener("click", () => {
                if (!confirm("Clear all issues? This cannot be undone.")) return;
                clearIssues();
                renderSidebarIssues();
            });
        });
    }

    function hideSidebar() {
        if (sidebarClosing) return;
        isSidebarVisible = false;

        if (sidebarEl) {
            sidebarClosing = true;
            sidebarEl.style.animation = "uiSidebarSlideOut 0.25s ease forwards";
            const el = sidebarEl;
            setTimeout(() => {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                sidebarClosing = false;
            }, 250);
        }
        sidebarEl = null;
    }

    function toggleSidebar() {
        isSidebarVisible ? hideSidebar() : showSidebar();
    }

    /** Re-renders all issue cards in the sidebar body */
    function renderSidebarIssues() {
        if (!sidebarEl) return;
        const body = sidebarEl.querySelector("#ui-inspector-sb-body");
        const countEl = sidebarEl.querySelector("#ui-inspector-sb-count");
        if (!body) return;

        countEl.textContent = issueList.length + " issue" + (issueList.length !== 1 ? "s" : "");

        if (issueList.length === 0) {
            body.innerHTML = '<div class="ui-inspector-sb-empty">No issues yet</div>';
            return;
        }

        body.innerHTML = "";
        issueList.slice().reverse().forEach((issue) => {
            const card = document.createElement("div");
            card.className = "ui-inspector-sb-card";

            const sevClass = (issue.severity || "medium").toLowerCase();
            const ts = issue.timestamp ? new Date(issue.timestamp).toLocaleString() : "";

            // Card summary (always visible)
            const summaryHtml =
                '<div class="ui-inspector-sb-card-top">'
                +   '<span class="ui-inspector-sb-dot ui-inspector-sb-dot-' + escapeHtml(sevClass) + '"></span>'
                +   '<span class="ui-inspector-sb-card-title">' + escapeHtml(issue.whatIsWrong || "Untitled") + '</span>'
                +   '<span class="ui-inspector-sb-card-chevron">\u203A</span>'
                + '</div>'
                + '<div class="ui-inspector-sb-card-meta">'
                +   escapeHtml(issue.component || "Unknown") + " \u00b7 " + escapeHtml(issue.page || "/")
                + '</div>';

            // Card detail (shown on expand)
            let detailHtml =
                '<div class="ui-inspector-sb-card-detail">'
                +   '<div><strong>What:</strong> ' + escapeHtml(issue.whatIsWrong || "") + '</div>'
                +   '<div><strong>Fix:</strong> ' + escapeHtml(issue.howToFix || "") + '</div>'
                +   '<div><strong>Element:</strong> &lt;' + escapeHtml(issue.element || "") + '&gt;</div>'
                +   '<div><strong>Selector:</strong> <code style="font-size:11px;word-break:break-all;">'
                +       escapeHtml(issue.selector || "")
                +   '</code></div>';

            if (issue.computedStyles) {
                const styleLines = Object.entries(issue.computedStyles)
                    .map(([p, v]) => escapeHtml(p) + ": " + escapeHtml(v))
                    .join("<br>");
                detailHtml +=
                    '<div style="margin-top:6px;"><strong>Styles:</strong>'
                    + '<div style="font-size:11px;font-family:monospace;margin-top:4px;line-height:1.8;">'
                    + styleLines + '</div></div>';
            }

            if (issue.screenshot) {
                detailHtml +=
                    '<div style="margin-top:8px;"><img src="' + escapeHtml(issue.screenshot)
                    + '" style="max-width:100%;border-radius:6px;border:1px solid #e5e7eb;" /></div>';
            }

            detailHtml += '<div><strong>Time:</strong> ' + escapeHtml(ts) + '</div></div>';

            card.innerHTML = summaryHtml + detailHtml;
            card.querySelector(".ui-inspector-sb-card-top").addEventListener("click", () => {
                card.classList.toggle("expanded");
            });
            body.appendChild(card);
        });
    }

    /* ══════════════════════════════════════════════════════
       Console API
       ══════════════════════════════════════════════════════ */

    /** Prints all logged issues to the console */
    function viewIssues() {
        if (issueList.length === 0) {
            console.log("[UI Inspector] No issues logged.");
            return;
        }
        console.table(issueList);
        return issueList;
    }

    window.viewIssues = viewIssues;
    window.clearIssues = clearIssues;
    window.inspectUI = enableInspectMode;
    window.toggleSidebar = toggleSidebar;

    /* ══════════════════════════════════════════════════════
       Theme Sync (live updates when popup toggles theme)
       ══════════════════════════════════════════════════════ */

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes["ui-inspector-theme"]) return;
        const newTheme = changes["ui-inspector-theme"].newValue;

        [sidebarEl, document.querySelector(".ui-inspector-modal")].forEach((el) => {
            if (!el) return;
            if (newTheme === "dark") {
                el.setAttribute("data-theme", "dark");
            } else {
                el.removeAttribute("data-theme");
            }
        });
    });

    /* ══════════════════════════════════════════════════════
       Message Handler (popup ↔ content script)
       ══════════════════════════════════════════════════════ */

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const status = () => ({
            isInspectMode,
            issueCount: issueList.length,
            issues: issueList,
            isSidebarVisible,
        });

        switch (message.type) {
            case "TOGGLE_INSPECT":
                isInspectMode ? disableInspectMode() : enableInspectMode();
                sendResponse(status());
                break;

            case "GET_STATUS":
                sendResponse(status());
                break;

            case "CLEAR_ISSUES":
                clearIssues();
                renderSidebarIssues();
                sendResponse({ issueCount: 0, issues: [], isInspectMode, isSidebarVisible });
                break;

            case "GET_ALL_ISSUES":
                sendResponse({ issues: issueList });
                break;

            case "TOGGLE_SIDEBAR":
                toggleSidebar();
                sendResponse({ isSidebarVisible });
                break;

            default:
                sendResponse({ error: "Unknown message type" });
        }
        return true; // Keep the message channel open for async sendResponse
    });

    /* ══════════════════════════════════════════════════════
       Initialization
       ══════════════════════════════════════════════════════ */

    loadIssues(() => {
        console.log("[UI Inspector] Content script loaded. Issues in storage:", issueList.length);
    });
})();
