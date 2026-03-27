/*
 * UI Inspector
 * Run window.inspectUI() in browser console to start.
 * Click any element to log a QA issue against it.
 */

export function setupUIInspector() {
    var isInspectMode = false;
    var issueList = [];

    window.inspectUI = function () {
        if (isInspectMode) {
            disableInspectMode();
            console.log('[inspector] inspect mode off');
            return;
        }

        isInspectMode = true;
        document.body.style.cursor = 'crosshair';
        document.addEventListener('click', handleElementClick, true);
        console.log('[inspector] inspect mode on - click any element');
    };

    window.viewIssues = function () {
        if (issueList.length === 0) {
            console.log('[inspector] no issues logged');
            return;
        }

        console.log('[inspector] --- all issues ---');
        for (var i = 0; i < issueList.length; i++) {
            console.log('#' + (i + 1));
            console.log(issueList[i]);
        }
        console.log('[inspector] --- end ---');

        var allIssues = issueList.join('\n\n---\n\n');
        copyToClipboard(allIssues);
        return allIssues;
    };

    window.clearIssues = function () {
        issueList = [];
        console.log('[inspector] issues cleared');
    };

    window.copyIssues = function () {
        if (issueList.length === 0) {
            console.log('[inspector] no issues to copy');
            return;
        }

        var allIssues = issueList.join('\n\n---\n\n');
        copyToClipboard(allIssues);
    };

    function enableInspectMode() {
        isInspectMode = true;
        document.body.style.cursor = 'crosshair';
        document.addEventListener('click', handleElementClick, true);
    }

    function disableInspectMode() {
        isInspectMode = false;
        document.body.style.cursor = 'auto';
        document.removeEventListener('click', handleElementClick, true);
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(function () {
            console.log('[inspector] copied to clipboard');
        }).catch(function () {
            showCopyFallback(text);
        });
    }

    function showCopyFallback(text) {
        var overlay = document.createElement('div');
        overlay.id = 'copy-issues-overlay';
        overlay.style.cssText = [
            'position: fixed',
            'top: 0',
            'left: 0',
            'right: 0',
            'bottom: 0',
            'background: rgba(0,0,0,0.7)',
            'z-index: 999999',
            'display: flex',
            'flex-direction: column',
            'align-items: center',
            'justify-content: center'
        ].join(';');

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close (Escape)';
        closeBtn.style.cssText = [
            'margin-bottom: 10px',
            'padding: 10px 20px',
            'background: #ef4444',
            'color: white',
            'border: none',
            'border-radius: 4px',
            'cursor: pointer',
            'font-size: 14px'
        ].join(';');

        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = [
            'width: 80%',
            'height: 60%',
            'font-family: monospace',
            'font-size: 12px',
            'padding: 16px',
            'border-radius: 8px'
        ].join(';');

        function closeOverlay() {
            overlay.remove();
            document.removeEventListener('keydown', onEscape);
        }

        function onEscape(e) {
            if (e.key === 'Escape') {
                closeOverlay();
            }
        }

        closeBtn.onclick = closeOverlay;
        document.addEventListener('keydown', onEscape);

        overlay.appendChild(closeBtn);
        overlay.appendChild(textarea);
        document.body.appendChild(overlay);

        textarea.select();
        textarea.focus();
        console.log('[inspector] select text and press Ctrl+C to copy');
    }

    function handleElementClick(event) {
        event.preventDefault();
        event.stopPropagation();

        var element = event.target;
        var componentInfo = findComponentInfo(element);

        var componentFile;
        if (componentInfo.component) {
            componentFile = componentInfo.component;
        } else {
            componentFile = '(unknown)';
        }

        var elementTag = element.tagName.toLowerCase();
        var elementId = element.id || '';
        var elementClasses = element.className || '';
        var elementText = '';
        if (element.innerText) {
            elementText = element.innerText.slice(0, 50);
        }
        var currentPath = window.location.pathname;

        // build parent hierarchy, up to 3 levels
        var hierarchy = [];
        var node = element;
        for (var i = 0; i < 3; i++) {
            if (!node) {
                break;
            }
            var tag = node.tagName ? node.tagName.toLowerCase() : '';
            var firstClass = '';
            if (node.className) {
                firstClass = '.' + node.className.split(' ')[0];
            }
            if (tag) {
                hierarchy.unshift(tag + firstClass);
            }
            node = node.parentElement;
        }

        console.log('[inspector] detected: ' + componentFile);
        console.log('[inspector] element: <' + elementTag + ' class="' + elementClasses + '">');
        console.log('[inspector] page: ' + currentPath);

        // pause inspect mode while prompts are open
        disableInspectMode();

        var whatsWrong = prompt(
            'Component: ' + componentFile + '\n' +
            'Page: ' + currentPath + '\n\n' +
            'What is wrong with this element?'
        );

        if (whatsWrong === null) {
            console.log('[inspector] cancelled');
            enableInspectMode();
            return;
        }

        var howToFix = prompt('How should this be fixed?');

        if (howToFix === null) {
            console.log('[inspector] cancelled');
            enableInspectMode();
            return;
        }

        var report = ''
            + 'Component: ' + componentFile + '\n'
            + 'Page: ' + currentPath + '\n'
            + 'Element: <' + elementTag + '>\n'
            + 'Classes: ' + (elementClasses || '(none)') + '\n'
            + 'ID: ' + (elementId || '(none)') + '\n'
            + 'Text: ' + (elementText || '(none)') + '\n'
            + 'Hierarchy: ' + hierarchy.join(' > ') + '\n'
            + 'What is wrong: ' + whatsWrong + '\n'
            + 'Fix: ' + howToFix;

        issueList.push(report);

        console.log('[inspector] issue #' + issueList.length + ' logged');
        console.log(report);

        copyToClipboard(report);

        enableInspectMode();
        console.log('[inspector] inspect mode still on - click another element or run window.inspectUI() to stop');
    }

    function findComponentInfo(element) {
        var current = element;
        var depth = 0;
        var maxDepth = 20;

        while (current && depth < maxDepth) {
            // check for data-component attribute
            if (current.dataset && current.dataset.component) {
                return {
                    component: current.dataset.component,
                    componentName: current.dataset.componentName || null
                };
            }

            // check for React fiber
            var keys = Object.keys(current);
            var fiberKey = null;
            for (var k = 0; k < keys.length; k++) {
                if (keys[k].startsWith('__react')) {
                    fiberKey = keys[k];
                    break;
                }
            }

            if (fiberKey && current[fiberKey]) {
                var fiber = current[fiberKey];
                var currentFiber = fiber;

                while (currentFiber) {
                    if (currentFiber.elementType && currentFiber.elementType.name) {
                        return {
                            component: currentFiber.elementType.name + '.jsx',
                            componentName: currentFiber.elementType.name
                        };
                    }
                    if (currentFiber.type && currentFiber.type.name) {
                        if (currentFiber.type.name !== 'Unknown') {
                            return {
                                component: currentFiber.type.name + '.jsx',
                                componentName: currentFiber.type.name
                            };
                        }
                    }
                    currentFiber = currentFiber.return;
                }
            }

            current = current.parentElement;
            depth++;
        }

        return {
            component: null,
            componentName: null
        };
    }

    console.log('[inspector] ready');
    console.log('window.inspectUI()   - start/stop inspect mode');
    console.log('window.viewIssues()  - view all logged issues');
    console.log('window.copyIssues()  - copy issues to clipboard');
    console.log('window.clearIssues() - clear all issues');
}
