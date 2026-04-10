(function () {
    try {
        var t = localStorage.getItem("ui-inspector-theme");
        if (t === "dark") {
            if (document.documentElement) {
                document.documentElement.setAttribute("data-theme", "dark");
            }
            if (document.body) {
                document.body.setAttribute("data-theme", "dark");
            }
        }
    } catch (e) { }
})();
