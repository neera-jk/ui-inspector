(() => {
    "use strict";

    let isInspectMode = false;
    let issueList = [];
    let lastHighlighted = null;
    let isSidebarVisible = false;
    let sidebarEl = null;
    let _sidebarClosing = false;
    let _modalClosing = false;

    // Loads any previously saved issues from localStorage, defaulting to an empty array
    function loadIssues() {
        try {
            const raw = localStorage.getItem("ui-inspector-issues");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    issueList = parsed;
                    return;
                }
            }
        } catch (e) {
            // ignore parse errors
        }
        issueList = [];
    }

    // Persists the current issueList array to localStorage as JSON
    function saveIssues() {
        localStorage.setItem("ui-inspector-issues", JSON.stringify(issueList));
    }

    // Walks up the React Fiber tree (up to 20 levels) to find the nearest component name.
    // First checks for a data-component attribute, then looks for __reactFiber or __reactInternalInstance keys.
    function findComponentInfo(element) {
        if (!element) return "Unknown";

        // Check data-component attribute first
        const dataComp = element.getAttribute && element.getAttribute("data-component");
        if (dataComp) return dataComp;

        // Look for React fiber key on the element
        const fiberKey = Object.keys(element).find(
            (key) => key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")
        );

        if (fiberKey) {
            let fiber = element[fiberKey];
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
        }

        // Walk up ancestors and check for data-component or fiber
        let ancestor = element.parentElement;
        let levels = 0;
        while (ancestor && levels < 20) {
            const ancestorData = ancestor.getAttribute && ancestor.getAttribute("data-component");
            if (ancestorData) return ancestorData;

            const ancestorFiberKey = Object.keys(ancestor).find(
                (key) => key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")
            );
            if (ancestorFiberKey) {
                let fiber = ancestor[ancestorFiberKey];
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
            }
            ancestor = ancestor.parentElement;
            levels++;
        }

        return "Unknown";
    }

    // Builds a 3-level parent hierarchy string (e.g. "div.container > section.main > article.card")
    function getParentHierarchy(element) {
        const parts = [];
        let current = element.parentElement;
        let levels = 0;
        while (current && levels < 3 && current !== document.body && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const firstClass = current.classList && current.classList.length > 0 ? "." + current.classList[0] : "";
            parts.push(tag + firstClass);
            current = current.parentElement;
            levels++;
        }
        return parts.join(" > ");
    }

    // Builds a unique CSS selector path from the element up to body
    function getCssSelector(element) {
        if (!element || element === document.body || element === document.documentElement) return "";
        var segments = [];
        var current = element;
        var depth = 0;
        while (current && current !== document.body && current !== document.documentElement && depth < 10) {
            if (current.id) {
                segments.push("#" + current.id);
                break;
            }
            var tag = current.tagName.toLowerCase();
            var firstClass = current.classList && current.classList.length > 0 ? "." + current.classList[0] : "";
            var nth = "";
            if (current.parentElement) {
                var idx = Array.from(current.parentElement.children).indexOf(current) + 1;
                nth = ":nth-child(" + idx + ")";
            }
            segments.push(tag + firstClass + nth);
            current = current.parentElement;
            depth++;
        }
        return segments.reverse().join(" > ");
    }

    // Handles mouseover during inspect mode: highlights the hovered element and removes highlight from the previous one
    function onMouseOver(e) {
        const target = e.target;
        if (target === document.body || target === document.documentElement) return;

        if (lastHighlighted && lastHighlighted !== target) {
            lastHighlighted.classList.remove("ui-inspector-highlight");
        }
        target.classList.add("ui-inspector-highlight");
        lastHighlighted = target;
    }

    // Handles mouseout during inspect mode: removes the highlight class from the element
    function onMouseOut(e) {
        const target = e.target;
        target.classList.remove("ui-inspector-highlight");
    }

    // Handles click during inspect mode: prevents default behavior, collects element data, and opens the issue modal
    function onClick(e) {
        e.preventDefault();
        e.stopPropagation();

        const element = e.target;

        // Remove highlight from clicked element
        if (lastHighlighted) {
            lastHighlighted.classList.remove("ui-inspector-highlight");
            lastHighlighted = null;
        }

        const componentName = findComponentInfo(element);

        const STYLE_PROPS = ["font-size", "font-weight", "color", "background-color", "border", "border-radius", "padding", "margin", "opacity", "box-shadow", "width", "height", "display", "line-height", "letter-spacing"];
        const computed = window.getComputedStyle(element);
        const computedStyles = {};
        STYLE_PROPS.forEach(function (p) { computedStyles[p] = computed.getPropertyValue(p); });

        const elementData = {
            tagName: element.tagName.toLowerCase(),
            id: element.id || "",
            className: element.className || "",
            innerText: (element.innerText || "").substring(0, 50),
            page: window.location.pathname,
            hierarchy: getParentHierarchy(element),
            component: componentName,
            selector: getCssSelector(element),
            computedStyles: computedStyles,
        };

        disableInspectMode();
        showInspectorModal(elementData, element);
    }

    // Enables inspect mode by attaching mouseover, mouseout, and click listeners to the document
    function enableInspectMode() {
        isInspectMode = true;
        document.addEventListener("mouseover", onMouseOver, false);
        document.addEventListener("mouseout", onMouseOut, false);
        document.addEventListener("click", onClick, true);
        document.body.style.cursor = "crosshair";
    }

    // Disables inspect mode by removing all event listeners and resetting cursor
    function disableInspectMode() {
        isInspectMode = false;
        document.removeEventListener("mouseover", onMouseOver, false);
        document.removeEventListener("mouseout", onMouseOut, false);
        document.removeEventListener("click", onClick, true);
        document.body.style.cursor = "";

        if (lastHighlighted) {
            lastHighlighted.classList.remove("ui-inspector-highlight");
            lastHighlighted = null;
        }
    }

    // Injects a modal overlay into the page for logging a new issue against the selected element
    function showInspectorModal(elementData, targetElement) {
        const backdrop = document.createElement("div");
        backdrop.className = "ui-inspector-modal";

        chrome.storage.local.get("ui-inspector-theme", (result) => {
            if (result["ui-inspector-theme"] === "dark") {
                backdrop.setAttribute("data-theme", "dark");
            }
            _buildAndMountModal(backdrop, elementData, targetElement);
        });
    }

    function _buildAndMountModal(backdrop, elementData, targetElement) {
        let selectedSeverity = "Medium";

        backdrop.innerHTML = `
      <div class="ui-inspector-card">
        <div class="ui-inspector-header">
          <h2>Log Issue</h2>
          <button class="ui-inspector-close-btn" data-action="close">✕</button>
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

        // Populate computed styles grid
        const stylesGrid = backdrop.querySelector("#ui-inspector-styles-grid");
        if (stylesGrid && elementData.computedStyles) {
            Object.entries(elementData.computedStyles).forEach(function ([prop, val]) {
                const row = document.createElement("div");
                row.className = "ui-inspector-styles-row";
                row.innerHTML = '<span class="ui-inspector-styles-prop">' + escapeHtml(prop) + '</span><span class="ui-inspector-styles-val">' + escapeHtml(val) + '</span>';
                stylesGrid.appendChild(row);
            });
        }

        // Handle severity button selection — only one can be active at a time
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

        // Removes the modal from the DOM and re-enables inspect mode
        function closeModal() {
            if (_modalClosing) return;
            var whatVal = (backdrop.querySelector("#ui-inspector-what") || {}).value || "";
            var howVal = (backdrop.querySelector("#ui-inspector-how") || {}).value || "";
            if (whatVal.trim() || howVal.trim()) {
                if (!confirm("You have unsaved changes. Discard this issue?")) return;
            }
            _modalClosing = true;
            var card = backdrop.querySelector(".ui-inspector-card");
            if (card) card.style.animation = "uiModalCardOut 0.25s ease forwards";
            backdrop.style.animation = "uiModalBackdropOut 0.25s ease forwards";
            setTimeout(function () {
                _modalClosing = false;
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                enableInspectMode();
            }, 250);
        }

        // Close button handler
        backdrop.querySelector("[data-action='close']").addEventListener("click", closeModal);

        // Clicking the backdrop (outside the card) closes the modal
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) {
                closeModal();
            }
        });

        // Save button handler — validates inputs, builds the issue object, and persists it
        backdrop.querySelector("[data-action='save']").addEventListener("click", () => {
            const whatField = backdrop.querySelector("#ui-inspector-what");
            const howField = backdrop.querySelector("#ui-inspector-how");
            const whatValue = whatField.value.trim();
            const howValue = howField.value.trim();

            if (!whatValue) {
                whatField.style.borderColor = "#ef4444";
                whatField.focus();
                return;
            }
            if (!howValue) {
                howField.style.borderColor = "#ef4444";
                howField.focus();
                return;
            }

            const issue = {
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
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

            _modalClosing = true;
            var card = backdrop.querySelector(".ui-inspector-card");
            if (card) card.style.animation = "uiModalCardOut 0.25s ease forwards";
            backdrop.style.animation = "uiModalBackdropOut 0.25s ease forwards";
            setTimeout(function () {
                _modalClosing = false;
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                renderSidebarIssues();
                enableInspectMode();
            }, 250);
        });

        document.body.appendChild(backdrop);

        // Capture screenshot of the target element (lazy-load html2canvas)
        if (targetElement && typeof html2canvas !== "function" && !document.querySelector('script[src*="html2canvas"]')) {
            var s = document.createElement("script");
            s.src = chrome.runtime.getURL("html2canvas.min.js");
            s.onload = function () { _captureScreenshot(targetElement, backdrop); };
            document.head.appendChild(s);
        } else if (targetElement && typeof html2canvas === "function") {
            _captureScreenshot(targetElement, backdrop);
        }
    }

    function _captureScreenshot(targetElement, backdrop) {
        if (typeof html2canvas !== "function") return;
        html2canvas(targetElement, { scale: 1, useCORS: true, logging: false }).then(function (canvas) {
            var dataUrl = canvas.toDataURL("image/png");
            backdrop.__screenshotDataUrl = dataUrl;
            var wrap = backdrop.querySelector("#ui-inspector-screenshot-wrap");
            if (wrap) {
                var img = document.createElement("img");
                img.src = dataUrl;
                img.style.cssText = "max-width:100%;border-radius:6px;border:1px solid var(--ui-border);margin-top:4px;";
                wrap.appendChild(img);
            }
        }).catch(function (err) {
            console.warn("[UI Inspector] Screenshot capture failed:", err.message || err);
        });
    }

    // ── Sidebar ──

    function showSidebar() {
        if (sidebarEl || _sidebarClosing) return;
        isSidebarVisible = true;
        sidebarEl = document.createElement("div");
        sidebarEl.className = "ui-inspector-sidebar";

        chrome.storage.local.get("ui-inspector-theme", (result) => {
            if (result["ui-inspector-theme"] === "dark") {
                sidebarEl.setAttribute("data-theme", "dark");
            }
            sidebarEl.innerHTML =
                '<div class="ui-inspector-sb-header">' +
                '<span class="ui-inspector-sb-title">UI Inspector</span>' +
                '<span class="ui-inspector-sb-count" id="ui-inspector-sb-count">' + issueList.length + ' issues</span>' +
                '<button class="ui-inspector-sb-close" id="ui-inspector-sb-close">\u2715</button>' +
                '</div>' +
                '<div class="ui-inspector-sb-body" id="ui-inspector-sb-body"></div>' +
                '<div class="ui-inspector-sb-footer">' +
                '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-json">JSON</button>' +
                '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-csv">CSV</button>' +
                '<button class="ui-inspector-sb-footer-btn" id="ui-inspector-sb-clear">Clear</button>' +
                '</div>';

            document.body.appendChild(sidebarEl);
            renderSidebarIssues();

            sidebarEl.querySelector("#ui-inspector-sb-close").addEventListener("click", hideSidebar);

            sidebarEl.querySelector("#ui-inspector-sb-json").addEventListener("click", function () {
                downloadFile(JSON.stringify(issueList, null, 2), "ui-inspector-export.json", "application/json");
            });

            sidebarEl.querySelector("#ui-inspector-sb-csv").addEventListener("click", function () {
                var headers = ["id", "severity", "whatIsWrong", "howToFix", "component", "page", "element", "timestamp"];
                var rows = [headers.join(",")];
                issueList.forEach(function (issue) {
                    var row = headers.map(function (h) {
                        var val = (issue[h] || "").toString().replace(/"/g, '""');
                        return '"' + val + '"';
                    });
                    rows.push(row.join(","));
                });
                downloadFile(rows.join("\n"), "ui-inspector-export.csv", "text/csv");
            });

            sidebarEl.querySelector("#ui-inspector-sb-clear").addEventListener("click", function () {
                if (!confirm("Clear all issues? This cannot be undone.")) return;
                clearIssues();
                renderSidebarIssues();
            });
        });
    }

    function hideSidebar() {
        if (_sidebarClosing) return;
        isSidebarVisible = false;
        if (sidebarEl) {
            _sidebarClosing = true;
            sidebarEl.style.animation = "uiSidebarSlideOut 0.25s ease forwards";
            var el = sidebarEl;
            setTimeout(function () {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                _sidebarClosing = false;
            }, 250);
        }
        sidebarEl = null;
    }

    function toggleSidebar() {
        if (isSidebarVisible) {
            hideSidebar();
        } else {
            showSidebar();
        }
    }

    function renderSidebarIssues() {
        if (!sidebarEl) return;
        var body = sidebarEl.querySelector("#ui-inspector-sb-body");
        var countEl = sidebarEl.querySelector("#ui-inspector-sb-count");
        if (!body) return;

        countEl.textContent = issueList.length + " issue" + (issueList.length !== 1 ? "s" : "");

        if (issueList.length === 0) {
            body.innerHTML = '<div class="ui-inspector-sb-empty">No issues yet</div>';
            return;
        }

        body.innerHTML = "";
        issueList.slice().reverse().forEach(function (issue) {
            var card = document.createElement("div");
            card.className = "ui-inspector-sb-card";

            var sevClass = (issue.severity || "medium").toLowerCase();
            var ts = issue.timestamp ? new Date(issue.timestamp).toLocaleString() : "";

            card.innerHTML =
                '<div class="ui-inspector-sb-card-top">' +
                '<span class="ui-inspector-sb-dot ui-inspector-sb-dot-' + escapeHtml(sevClass) + '"></span>' +
                '<span class="ui-inspector-sb-card-title">' + escapeHtml(issue.whatIsWrong || "Untitled") + '</span>' +
                '<span class="ui-inspector-sb-card-chevron">\u203A</span>' +
                '</div>' +
                '<div class="ui-inspector-sb-card-meta">' + escapeHtml(issue.component || "Unknown") + ' \u00b7 ' + escapeHtml(issue.page || "/") + '</div>' +
                '<div class="ui-inspector-sb-card-detail">' +
                '<div><strong>What:</strong> ' + escapeHtml(issue.whatIsWrong || "") + '</div>' +
                '<div><strong>Fix:</strong> ' + escapeHtml(issue.howToFix || "") + '</div>' +
                '<div><strong>Element:</strong> &lt;' + escapeHtml(issue.element || "") + '&gt;</div>' +
                '<div><strong>Selector:</strong> <code style="font-size:11px;word-break:break-all;">' + escapeHtml(issue.selector || "") + '</code></div>' +
                (issue.computedStyles ? '<div style="margin-top:6px;"><strong>Styles:</strong><div style="font-size:11px;font-family:monospace;margin-top:4px;line-height:1.8;">' + Object.entries(issue.computedStyles).map(function ([p, v]) { return escapeHtml(p) + ': ' + escapeHtml(v); }).join('<br>') + '</div></div>' : '') +
                (issue.screenshot ? '<div style="margin-top:8px;"><img src="' + escapeHtml(issue.screenshot) + '" style="max-width:100%;border-radius:6px;border:1px solid #e5e7eb;" /></div>' : '') +
                '<div><strong>Time:</strong> ' + escapeHtml(ts) + '</div>' +
                '</div>';

            card.querySelector(".ui-inspector-sb-card-top").addEventListener("click", function () {
                card.classList.toggle("expanded");
            });

            body.appendChild(card);
        });

    }

    function downloadFile(content, filename, type) {
        var blob = new Blob([content], { type: type });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Escapes HTML special characters to prevent injection when rendering element data in the modal
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // Prints all logged issues to the console in a readable table format
    function viewIssues() {
        if (issueList.length === 0) {
            console.log("[UI Inspector] No issues logged.");
            return;
        }
        console.table(issueList);
        return issueList;
    }

    // Clears all logged issues from memory and localStorage
    function clearIssues() {
        issueList = [];
        localStorage.removeItem("ui-inspector-issues");
        console.log("[UI Inspector] All issues cleared.");
    }

    // Expose viewIssues and clearIssues on window for console access
    window.viewIssues = viewIssues;
    window.clearIssues = clearIssues;
    window.inspectUI = enableInspectMode;
    window.toggleSidebar = toggleSidebar;

    // Listens for messages from the popup and responds with current state or toggles inspect mode
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "TOGGLE_INSPECT") {
            if (isInspectMode) {
                disableInspectMode();
            } else {
                enableInspectMode();
            }
            sendResponse({ isInspectMode, issueCount: issueList.length, issues: issueList, isSidebarVisible });
        } else if (message.type === "GET_STATUS") {
            sendResponse({ isInspectMode, issueCount: issueList.length, issues: issueList, isSidebarVisible });
        } else if (message.type === "CLEAR_ISSUES") {
            clearIssues();
            renderSidebarIssues();
            sendResponse({ issueCount: 0, issues: [], isInspectMode, isSidebarVisible });
        } else if (message.type === "GET_ALL_ISSUES") {
            sendResponse({ issues: issueList });
        } else if (message.type === "TOGGLE_SIDEBAR") {
            toggleSidebar();
            sendResponse({ isSidebarVisible });
        }
        return true;
    });

    // Initialize by loading saved issues
    loadIssues();
    console.log("[UI Inspector] Content script loaded. Issues in storage:", issueList.length);
})();
