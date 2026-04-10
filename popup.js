// Sends a message to the content script running in the active tab and returns the response.
// If the content script is not yet injected, injects it and retries once.
function sendMessageToActiveTab(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                reject(new Error("No active tab found"));
                return;
            }
            const tabId = tabs[0].id;
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || "";
                    if (errMsg.includes("Could not establish connection")) {
                        // Content script not injected — inject it now and retry
                        Promise.all([
                            chrome.scripting.executeScript({ target: { tabId }, files: ["html2canvas.min.js", "content.js"] }),
                            chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }),
                        ])
                            .then(() => {
                                chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
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

function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// Updates all UI elements based on current state
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

// Triggers a JSON file download with all issues
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

// Triggers a CSV file download with all issues
function downloadCSV(issues) {
    if (!issues || issues.length === 0) return;
    var headers = ["id", "severity", "whatIsWrong", "howToFix", "component", "page", "element", "timestamp"];
    var csvRows = [headers.join(",")];
    issues.forEach(function (issue) {
        var row = headers.map(function (h) {
            var val = (issue[h] || "").toString().replace(/"/g, '""');
            return '"' + val + '"';
        });
        csvRows.push(row.join(","));
    });
    var blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "ui-inspector-export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// On popup load, fetch current status and set up handlers
document.addEventListener("DOMContentLoaded", () => {
    // Apply saved theme to body
    chrome.storage.local.get("ui-inspector-theme", (result) => {
        if (result["ui-inspector-theme"] === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
            document.body.setAttribute("data-theme", "dark");
        }
    });

    // Theme toggle
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

    // Get initial status
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
            updateUI(false, 0);
        });

    // Toggle inspect mode
    document.getElementById("ctaBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "TOGGLE_INSPECT" })
            .then((response) => {
                if (response) {
                    updateUI(response.isInspectMode, response.issueCount);
                }
            })
            .catch(() => { });
    });

    // Toggle sidebar panel
    document.getElementById("panelBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "TOGGLE_SIDEBAR" })
            .then((response) => {
                if (response) {
                    document.getElementById("panelBtn").textContent = response.isSidebarVisible ? "Hide Panel" : "Show Panel";
                }
            })
            .catch(() => { });
    });

    // Clear all issues
    document.getElementById("clearBtn").addEventListener("click", () => {
        if (!confirm("Clear all issues? This cannot be undone.")) return;
        sendMessageToActiveTab({ type: "CLEAR_ISSUES" })
            .then((response) => {
                if (response) {
                    updateUI(response.isInspectMode, 0);
                }
            })
            .catch(() => { });
    });

    // Export JSON
    document.getElementById("exportBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "GET_ALL_ISSUES" })
            .then((response) => {
                if (response && response.issues) {
                    downloadJSON(response.issues);
                }
            })
            .catch(() => { });
    });
});
