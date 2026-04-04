// Sends a message to the content script running in the active tab and returns the response
function sendMessageToActiveTab(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                reject(new Error("No active tab found"));
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
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
function updateUI(isInspectMode, issueCount, issues) {
    const dot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const badge = document.getElementById("issueBadge");
    const ctaBtn = document.getElementById("ctaBtn");
    const recentList = document.getElementById("recentList");

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

    renderRecentIssues(recentList, issues);
}

function renderRecentIssues(container, issues) {
    container.innerHTML = "";

    if (!issues || issues.length === 0) {
        container.innerHTML = '<li class="empty-state">No issues yet</li>';
        return;
    }

    const recent = issues.slice(-3).reverse();
    recent.forEach((issue) => {
        const li = document.createElement("li");
        li.className = "recent-item";

        const severityClass = (issue.severity || "medium").toLowerCase();
        const title = escapeHtml(issue.whatIsWrong || "Untitled");
        const component = escapeHtml(issue.component || "Unknown");
        const page = escapeHtml(issue.page || "/");

        li.innerHTML =
            '<div class="recent-item-top">' +
            '<span class="severity-badge ' + severityClass + '">' + escapeHtml(severityClass) + '</span>' +
            '<span class="recent-item-title">' + title + '</span>' +
            '</div>' +
            '<div class="recent-item-meta">' + component + ' · ' + page + '</div>';

        container.appendChild(li);
    });
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

// On popup load, fetch current status and set up handlers
document.addEventListener("DOMContentLoaded", () => {
    // Apply saved theme to body
    const savedTheme = localStorage.getItem("ui-inspector-theme");
    if (savedTheme === "dark") {
        document.body.setAttribute("data-theme", "dark");
    }

    // Theme toggle
    document.getElementById("themeToggle").addEventListener("click", () => {
        const isDark = document.body.getAttribute("data-theme") === "dark";
        if (isDark) {
            document.body.removeAttribute("data-theme");
            document.documentElement.removeAttribute("data-theme");
            localStorage.setItem("ui-inspector-theme", "light");
        } else {
            document.body.setAttribute("data-theme", "dark");
            document.documentElement.setAttribute("data-theme", "dark");
            localStorage.setItem("ui-inspector-theme", "dark");
        }
    });

    // Get initial status
    sendMessageToActiveTab({ type: "GET_STATUS" })
        .then((response) => {
            if (response) {
                updateUI(response.isInspectMode, response.issueCount, response.issues || []);
            }
        })
        .catch(() => {
            updateUI(false, 0, []);
        });

    // Toggle inspect mode
    document.getElementById("ctaBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "TOGGLE_INSPECT" })
            .then((response) => {
                if (response) {
                    updateUI(response.isInspectMode, response.issueCount, response.issues || []);
                }
            })
            .catch(() => { });
    });

    // Clear all issues
    document.getElementById("clearBtn").addEventListener("click", () => {
        sendMessageToActiveTab({ type: "CLEAR_ISSUES" })
            .then((response) => {
                if (response) {
                    updateUI(response.isInspectMode, 0, []);
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
