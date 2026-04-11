/**
 * UI Inspector — Theme Initializer
 *
 * Runs synchronously in <head> (before paint) to prevent a flash of
 * unstyled content (FOUC) when dark mode is active. Reads localStorage
 * first for instant application, then verifies against chrome.storage.local
 * (the authoritative source) and corrects any mismatch.
 */
(function () {
    try {
        // Synchronous flash prevention: check localStorage first
        var t = localStorage.getItem("ui-inspector-theme");
        if (t === "dark" && document.documentElement) {
            document.documentElement.setAttribute("data-theme", "dark");
        }
        // Then verify against chrome.storage.local (authoritative source)
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get("ui-inspector-theme", function (result) {
                var theme = result["ui-inspector-theme"];
                if (theme === "dark") {
                    if (document.documentElement) document.documentElement.setAttribute("data-theme", "dark");
                    if (document.body) document.body.setAttribute("data-theme", "dark");
                } else if (theme === "light") {
                    if (document.documentElement) document.documentElement.removeAttribute("data-theme");
                    if (document.body) document.body.removeAttribute("data-theme");
                }
            });
        }
    } catch (e) { }
})();
