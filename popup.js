/**
 * UI Inspector — Popup Script
 *
 * Controls the extension popup UI. Communicates with the content script
 * via chrome.runtime messaging. Handles:
 *  - Inspect mode toggle
 *  - Sidebar panel toggle
 *  - Issue clearing and JSON export
 *  - Light/dark theme toggling
 */

/* ══════════════════════════════════════════════════════
   Messaging
   ══════════════════════════════════════════════════════ */

/**
 * Sends a message to the content script in the active tab.
 * If the content script isn't injected yet, injects it and retries once.
 * Uses frameId: 0 to target only the top frame (avoids duplicate responses from iframes).
 */
function sendMessageToActiveTab(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                reject(new Error("No active tab found"));
                return;
            }
            const tabId = tabs[0].id;

            chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || "";

                    if (errMsg.includes("Could not establish connection")) {
                        // Content script not loaded — inject and retry
                        Promise.all([
                            chrome.scripting.executeScript({ target: { tabId }, files: ["html2canvas.min.js", "content.js"] }),
                            chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }),
                        ])
                            .then(() => {
                                chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (retryResponse) => {
                                    if (chrome.runtime.lastError) {
                                        reject(new Error(chrome.runtime.lastError.message));
                                        return;
                                    }
                                    resolve(retryResponse);
                                });
                            })
                            .catch(reject);
                    } else {
                        reject(new Error(errMsg));
                    }
                    return;
                }
                resolve(response);
            });
        });
    });
}

/* ══════════════════════════════════════════════════════
   UI Helpers
   ══════════════════════════════════════════════════════ */

/** Updates the status dot, label text, and issue badge to reflect current state */
function updateUI(isInspectMode, issueCount) {
    const dot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const badge = document.getElementById("issueBadge");
    const ctaBtn = document.getElementById("ctaBtn");

    if (isInspectMode) {
        dot.classList.add("active");
        statusText.textContent = "Inspecting...";
        ctaBtn.textContent = "Stop inspecting";
    } else {
        dot.classList.remove("active");
        statusText.textContent = "Inactive";
        ctaBtn.textContent = "Start inspecting";
    }

    badge.textContent = issueCount + " issue" + (issueCount !== 1 ? "s" : "");
}

/** Triggers a JSON file download in the browser */
function downloadJSON(issues) {
    const blob = new Blob([JSON.stringify(issues, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ui-inspector-export.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════
   Initialization (runs when popup opens)
   ══════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ── Apply saved theme ──
    chrome.storage.local.get("ui-inspector-theme", (result) => {
        if (result["ui-inspector-theme"] === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
            document.body.setAttribute("data-theme", "dark");
        }
    });

    // ── Theme toggle ──
    document.getElementById("themeToggle").addEventListener("click", () => {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) {
            document.body.removeAttribute("data-theme");
            document.documentElement.removeAttribute("data-theme");
            localStorage.setItem("ui-inspector-theme", "light");
            chrome.storage.local.set({ "ui-inspector-theme": "light" });
        } else {
            document.body.setAttribute("data-theme", "dark");
            document.documentElement.setAttribute("data-theme", "dark");
            localStorage.setItem("ui-inspector-theme", "dark");
            chrome.storage.local.set({ "ui-inspector-theme": "dark" });
        }
    });

    // ── Fetch initial status from content script ──
    sendMessageToActiveTab({ type: "GET_STATUS" })
        .then((response) => {
            if (response) {
                updateUI(response.isInspectMode, response.issueCount);
                if (response.isSidebarVisible) {
                    document.getElementById("panelBtn").textContent = "Hide Panel";
                }
            }
        })
        .catch(() => {
            console.warn("[UI Inspector] Could not get status from content script.");
            updateUI(false, 0);
        });

    // ── Button handlers ──

    document.getElementById("ctaBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "TOGGLE_INSPECT" })
            .then((response) => {
                if (response) updateUI(response.isInspectMode, response.issueCount);
            })
            .catch((err) => { console.warn("[UI Inspector] Toggle inspect failed:", err.message); });
    });

    document.getElementById("panelBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "TOGGLE_SIDEBAR" })
            .then((response) => {
                if (response) {
                    document.getElementById("panelBtn").textContent =
                        response.isSidebarVisible ? "Hide Panel" : "Show Panel";
                }
            })
            .catch((err) => { console.warn("[UI Inspector] Toggle sidebar failed:", err.message); });
    });

    document.getElementById("clearBtn").addEventListener("click", () => {
        if (!confirm("Clear all issues? This cannot be undone.")) return;
        sendMessageToActiveTab({ type: "CLEAR_ISSUES" })
            .then((response) => {
                if (response) updateUI(response.isInspectMode, 0);
            })
            .catch((err) => { console.warn("[UI Inspector] Clear issues failed:", err.message); });
    });

    document.getElementById("exportBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "GET_ALL_ISSUES" })
            .then((response) => {
                if (response && response.issues) downloadJSON(response.issues);
            })
            .catch((err) => { console.warn("[UI Inspector] Export failed:", err.message); });
    });
});
