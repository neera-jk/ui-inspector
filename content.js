(() => {
    "use strict";

    let isInspectMode = false;
    let issueList = [];
    let lastHighlighted = null;

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
        const elementData = {
            tagName: element.tagName.toLowerCase(),
            id: element.id || "",
            className: element.className || "",
            innerText: (element.innerText || "").substring(0, 50),
            page: window.location.pathname,
            hierarchy: getParentHierarchy(element),
            component: componentName,
        };

        disableInspectMode();
        showInspectorModal(elementData);
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
    function showInspectorModal(elementData) {
        const backdrop = document.createElement("div");
        backdrop.className = "ui-inspector-modal";

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
        </div>
        <label class="ui-inspector-label">What is wrong?</label>
        <textarea class="ui-inspector-textarea" id="ui-inspector-what" placeholder="Describe the issue..."></textarea>
        <label class="ui-inspector-label">How should this be fixed?</label>
        <textarea class="ui-inspector-textarea" id="ui-inspector-how" placeholder="Describe the fix..."></textarea>
        <label class="ui-inspector-label">Severity</label>
        <div class="ui-inspector-severity-row">
          <button class="ui-inspector-severity-btn" data-severity="Low">Low</button>
          <button class="ui-inspector-severity-btn selected-medium" data-severity="Medium">Medium</button>
          <button class="ui-inspector-severity-btn" data-severity="High">High</button>
          <button class="ui-inspector-severity-btn" data-severity="Critical">Critical</button>
        </div>
        <button class="ui-inspector-save-btn" data-action="save">Save Issue</button>
      </div>
    `;

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
            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
            enableInspectMode();
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
                whatIsWrong: whatValue,
                howToFix: howValue,
                severity: selectedSeverity,
                timestamp: new Date().toISOString(),
            };

            issueList.push(issue);
            saveIssues();

            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
            enableInspectMode();
        });

        document.body.appendChild(backdrop);
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

    // Listens for messages from the popup and responds with current state or toggles inspect mode
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "TOGGLE_INSPECT") {
            if (isInspectMode) {
                disableInspectMode();
            } else {
                enableInspectMode();
            }
            sendResponse({ isInspectMode, issueCount: issueList.length, issues: issueList });
        } else if (message.type === "GET_STATUS") {
            sendResponse({ isInspectMode, issueCount: issueList.length, issues: issueList });
        } else if (message.type === "CLEAR_ISSUES") {
            clearIssues();
            sendResponse({ issueCount: 0, issues: [] });
        } else if (message.type === "GET_ALL_ISSUES") {
            sendResponse({ issues: issueList });
        }
        return true;
    });

    // Initialize by loading saved issues
    loadIssues();
    console.log("[UI Inspector] Content script loaded. Issues in storage:", issueList.length);
})();
