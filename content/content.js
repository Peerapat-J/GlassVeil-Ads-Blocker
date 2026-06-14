// content/content.js

var GlassVeilPickerUtils = globalThis.GlassVeilPickerUtils || (() => {
    const pickerStateClasses = new Set([
        "glassveil-picker-hovered",
        "glassveil-picker-selected"
    ]);

    const isPickerStateClass = (className) => pickerStateClasses.has(className);

    const formatSelectedOutlineLabel = (selectedIndex) => `${selectedIndex + 1}`;

    const clampPanelPosition = ({
        left,
        top,
        panelWidth,
        panelHeight,
        viewportWidth,
        viewportHeight
    }) => {
        const maxLeft = Math.max(0, viewportWidth - panelWidth);
        const maxTop = Math.max(0, viewportHeight - panelHeight);

        return {
            left: Math.max(0, Math.min(left, maxLeft)),
            top: Math.max(0, Math.min(top, maxTop))
        };
    };

    const mergeUniqueSelectors = (existingSelectors = [], newSelectors = []) => {
        const mergedSelectors = Array.isArray(existingSelectors) ? [...existingSelectors] : [];

        newSelectors.forEach((selector) => {
            if (typeof selector !== "string") return;

            const trimmedSelector = selector.trim();
            if (trimmedSelector && !mergedSelectors.includes(trimmedSelector)) {
                mergedSelectors.push(trimmedSelector);
            }
        });

        return mergedSelectors;
    };

    const formatConfirmButtonLabel = (selectedCount) => `Block Selected (${selectedCount})`;

    const formatSelectionSummary = (selectedCount, activeSelector = "") => {
        if (selectedCount === 0) return "";
        if (selectedCount === 1) return activeSelector || "1 element selected";
        return `${selectedCount} elements selected`;
    };

    return {
        isPickerStateClass,
        formatSelectedOutlineLabel,
        clampPanelPosition,
        mergeUniqueSelectors,
        formatConfirmButtonLabel,
        formatSelectionSummary
    };
})();

globalThis.GlassVeilPickerUtils = GlassVeilPickerUtils;

if (typeof module !== "undefined" && module.exports) {
    module.exports = GlassVeilPickerUtils;
}

if (typeof window !== "undefined") {
(function () {
    // Prevent duplicate injection
    if (window.glassVeilInjected) return;
    window.glassVeilInjected = true;

    const {
        isPickerStateClass,
        formatSelectedOutlineLabel,
        clampPanelPosition,
        mergeUniqueSelectors,
        formatConfirmButtonLabel,
        formatSelectionSummary
    } = GlassVeilPickerUtils;

    const currentDomain = window.location.hostname;
    let isBlockerEnabled = true;
    let activeSelectors = [];

    // Create style element immediately at document_start to avoid flickering
    const styleEl = document.createElement("style");
    styleEl.id = "glassveil-injected-style";

    // Append to documentElement because head/body might not exist yet
    if (document.documentElement) {
        document.documentElement.appendChild(styleEl);
    } else {
        // Fallback if documentElement is not ready (rare)
        const observer = new MutationObserver(() => {
            if (document.documentElement) {
                document.documentElement.appendChild(styleEl);
                observer.disconnect();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }

    // 1. Core Hiding Engine: Fetch rules and apply them
    const applyRules = (selectors, enabled) => {
        console.log("[GlassVeil] Applying rules. Enabled:", enabled, "Selectors:", selectors);
        if (!enabled || !selectors || selectors.length === 0) {
            styleEl.textContent = "";
            return;
        }
        // Generate cosmetic blocking CSS rule
        const cssRules = selectors
            .map(sel => `${sel} { display: none !important; }`)
            .join("\n");
        styleEl.textContent = cssRules;
    };

    const applyRulesFromStorage = async () => {
        try {
            const { disabledSites = {}, rules = {} } = await chrome.storage.local.get(["disabledSites", "rules"]);
            isBlockerEnabled = !disabledSites[currentDomain];
            activeSelectors = rules[currentDomain] || [];
            console.log("[GlassVeil] Loaded from storage for domain:", currentDomain, "rules:", activeSelectors, "enabled:", isBlockerEnabled);
            applyRules(activeSelectors, isBlockerEnabled);
        } catch (err) {
            console.error("[GlassVeil] Failed to load rules from storage:", err);
        }
    };

    // Run immediately
    applyRulesFromStorage();

    // Listen for storage changes to support real-time toggle/delete in popup
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local") {
            console.log("[GlassVeil] Storage changed:", changes);
            if (changes.rules || changes.disabledSites) {
                applyRulesFromStorage();
            }
        }
    });

    // Listen to messages from popup/background scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "startPicker") {
            startPicker();
            sendResponse({ status: "picker_started" });
        } else if (message.action === "toggleBlocker") {
            isBlockerEnabled = message.enabled;
            applyRules(activeSelectors, isBlockerEnabled);
            sendResponse({ status: "blocker_toggled" });
        } else if (message.action === "updateRules") {
            activeSelectors = message.rules;
            applyRules(activeSelectors, isBlockerEnabled);
            sendResponse({ status: "rules_updated" });
        }
        return true; // Keep channel open
    });

    // ==========================================
    // ELEMENT PICKER ENGINE
    // ==========================================

    let isPickerActive = false;
    let hoveredElement = null;
    let selectedElements = new Set();
    let activeSelectedElement = null;
    const previewedElements = new Map();
    const selectedOutlineBoxes = new Map();
    let outlineUpdateFrame = null;

    // UI container references
    let pickerRoot = null;
    let shadowRoot = null;
    let pickerPanel = null;

    const getOutlineLayer = () => shadowRoot ? shadowRoot.getElementById("selected-outline-layer") : null;

    const clearSelectedOutlines = () => {
        selectedOutlineBoxes.forEach((outlineBox) => outlineBox.remove());
        selectedOutlineBoxes.clear();

        if (outlineUpdateFrame !== null) {
            cancelAnimationFrame(outlineUpdateFrame);
            outlineUpdateFrame = null;
        }
    };

    const syncSelectedOutlines = () => {
        const outlineLayer = getOutlineLayer();
        if (!outlineLayer) return;

        Array.from(selectedElements).forEach((element) => {
            if (!element.isConnected) {
                selectedElements.delete(element);
                selectedOutlineBoxes.get(element)?.remove();
                selectedOutlineBoxes.delete(element);
            }
        });

        selectedOutlineBoxes.forEach((outlineBox, element) => {
            if (!selectedElements.has(element)) {
                outlineBox.remove();
                selectedOutlineBoxes.delete(element);
            }
        });

        Array.from(selectedElements).forEach((element, index) => {
            let outlineBox = selectedOutlineBoxes.get(element);
            if (!outlineBox) {
                outlineBox = document.createElement("div");
                outlineBox.className = "selected-outline";

                const outlineLabel = document.createElement("span");
                outlineLabel.className = "selected-outline-label";
                outlineBox.appendChild(outlineLabel);

                outlineLayer.appendChild(outlineBox);
                selectedOutlineBoxes.set(element, outlineBox);
            }

            const rect = element.getBoundingClientRect();
            const isVisible = rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth;

            if (!isVisible) {
                outlineBox.style.display = "none";
                return;
            }

            const left = Math.max(0, rect.left);
            const top = Math.max(0, rect.top);
            const right = Math.min(window.innerWidth, rect.right);
            const bottom = Math.min(window.innerHeight, rect.bottom);

            outlineBox.style.display = "block";
            outlineBox.style.left = `${left}px`;
            outlineBox.style.top = `${top}px`;
            outlineBox.style.width = `${Math.max(0, right - left)}px`;
            outlineBox.style.height = `${Math.max(0, bottom - top)}px`;

            const outlineLabel = outlineBox.querySelector(".selected-outline-label");
            if (outlineLabel) {
                outlineLabel.textContent = formatSelectedOutlineLabel(index);
            }
        });
    };

    const scheduleSelectedOutlineSync = () => {
        if (!isPickerActive || outlineUpdateFrame !== null) return;

        outlineUpdateFrame = requestAnimationFrame(() => {
            outlineUpdateFrame = null;
            syncSelectedOutlines();
        });
    };

    const handleViewportChange = () => {
        clampPickerPanelToViewport();
        scheduleSelectedOutlineSync();
    };

    const clampPickerPanelToViewport = () => {
        if (!pickerPanel || !pickerPanel.classList.contains("free")) return;

        const rect = pickerPanel.getBoundingClientRect();
        const position = clampPanelPosition({
            left: rect.left,
            top: rect.top,
            panelWidth: rect.width,
            panelHeight: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
        });

        pickerPanel.style.left = `${position.left}px`;
        pickerPanel.style.top = `${position.top}px`;
    };

    const restorePreviewForElement = (element) => {
        if (!previewedElements.has(element)) return;

        const originalDisplay = previewedElements.get(element);
        if (originalDisplay !== "") {
            element.style.display = originalDisplay;
        } else {
            element.style.removeProperty("display");
        }

        previewedElements.delete(element);
    };

    const restorePreview = () => {
        Array.from(previewedElements.keys()).forEach(restorePreviewForElement);
    };

    const previewElement = (element) => {
        if (!element || previewedElements.has(element)) return;

        previewedElements.set(element, element.style.display);
        element.style.setProperty("display", "none", "important");
    };

    const isPreviewEnabled = () => {
        const toggle = shadowRoot ? shadowRoot.getElementById("preview-toggle") : null;
        return Boolean(toggle && toggle.classList.contains("checked"));
    };

    const applyPreviewToSelection = () => {
        selectedElements.forEach(previewElement);

        Array.from(previewedElements.keys()).forEach((element) => {
            if (!selectedElements.has(element)) {
                restorePreviewForElement(element);
            }
        });
    };

    const updateSelectionControls = () => {
        if (!shadowRoot) return;

        const selectedCount = selectedElements.size;
        const hasSelection = selectedCount > 0;
        const activeSelector = activeSelectedElement ? generateSelector(activeSelectedElement) : "";

        const instruction = shadowRoot.getElementById("picker-instruction");
        const selectionCount = shadowRoot.getElementById("selection-count");
        const displayInput = shadowRoot.getElementById("selector-display");
        const parentBtn = shadowRoot.getElementById("parent-btn");
        const previewToggle = shadowRoot.getElementById("preview-toggle");
        const confirmBtn = shadowRoot.getElementById("confirm-btn");

        if (instruction) {
            instruction.textContent = hasSelection
                ? "Click more elements to add, or click selected elements to remove"
                : "Hover over elements and click to select";
        }

        if (selectionCount) {
            selectionCount.textContent = `${selectedCount} selected`;
        }

        if (displayInput) {
            displayInput.value = formatSelectionSummary(selectedCount, activeSelector);
        }

        if (parentBtn) {
            parentBtn.style.display = activeSelectedElement ? "block" : "none";
        }

        if (previewToggle) {
            previewToggle.style.display = hasSelection ? "flex" : "none";
            if (!hasSelection) {
                previewToggle.classList.remove("checked");
                restorePreview();
            }
        }

        if (confirmBtn) {
            confirmBtn.style.display = hasSelection ? "block" : "none";
            confirmBtn.textContent = formatConfirmButtonLabel(selectedCount);
        }

        syncSelectedOutlines();
    };

    const startPicker = () => {
        if (isPickerActive) return;
        isPickerActive = true;
        selectedElements = new Set();
        activeSelectedElement = null;
        hoveredElement = null;
        previewedElements.clear();

        // Create the Shadow DOM container for Picker UI
        pickerRoot = document.createElement("div");
        pickerRoot.id = "glassveil-picker-root";
        // Ensure the container is isolated from page layouts
        pickerRoot.style.position = "fixed";
        pickerRoot.style.zIndex = "2147483647"; // Max z-index
        pickerRoot.style.top = "0";
        pickerRoot.style.left = "0";
        pickerRoot.style.width = "0";
        pickerRoot.style.height = "0";
        document.body.appendChild(pickerRoot);

        shadowRoot = pickerRoot.attachShadow({ mode: "open" });

        // Inject Shadow DOM UI Markup & Style
        injectShadowUI();

        // Event listeners
        document.addEventListener("mouseover", handleMouseOver, true);
        document.addEventListener("mouseout", handleMouseOut, true);
        document.addEventListener("click", handleElementClick, true);
        document.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("scroll", handleViewportChange, true);
        window.addEventListener("resize", handleViewportChange, true);
    };

    const stopPicker = () => {
        if (!isPickerActive) return;
        isPickerActive = false;

        restorePreview();

        // Remove picker outline classes
        if (hoveredElement) {
            hoveredElement.classList.remove("glassveil-picker-hovered");
        }
        selectedElements.forEach((element) => {
            element.classList.remove("glassveil-picker-hovered", "glassveil-picker-selected");
        });
        clearSelectedOutlines();

        // Clean up event listeners
        document.removeEventListener("mouseover", handleMouseOver, true);
        document.removeEventListener("mouseout", handleMouseOut, true);
        document.removeEventListener("click", handleElementClick, true);
        document.removeEventListener("keydown", handleKeyDown, true);
        document.removeEventListener("scroll", handleViewportChange, true);
        window.removeEventListener("resize", handleViewportChange, true);

        // Remove Shadow DOM UI
        if (pickerRoot && pickerRoot.parentNode) {
            pickerRoot.parentNode.removeChild(pickerRoot);
        }
        pickerRoot = null;
        shadowRoot = null;
        pickerPanel = null;
        hoveredElement = null;
        selectedElements.clear();
        activeSelectedElement = null;
    };

    // Shadow DOM UI Markup
    const injectShadowUI = () => {
        const style = document.createElement("style");
        style.textContent = `
            :host {
                all: initial;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .picker-panel {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(100px);
                background: rgba(13, 14, 21, 0.85);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 16px 20px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                display: flex;
                flex-direction: column;
                gap: 12px;
                width: 460px;
                z-index: 2147483647;
                opacity: 0;
                transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
                max-width: calc(100vw - 32px);
            }

            .selected-outline-layer {
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                pointer-events: none;
                z-index: 2147483646;
            }

            .selected-outline {
                position: fixed;
                box-sizing: border-box;
                border: 2px solid #00f2fe;
                border-radius: 4px;
                background: rgba(0, 242, 254, 0.06);
                box-shadow: 0 0 0 1px rgba(2, 8, 23, 0.75), 0 0 18px rgba(0, 242, 254, 0.75);
                pointer-events: none;
            }

            .selected-outline-label {
                position: absolute;
                top: -10px;
                left: -10px;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                border-radius: 999px;
                background: #00f2fe;
                color: #020617;
                border: 1px solid rgba(255, 255, 255, 0.9);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
                font-size: 11px;
                font-weight: 800;
                line-height: 18px;
                text-align: center;
            }

            .picker-panel.active {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }

            /* When freely positioned after a drag, disable centering transform */
            .picker-panel.free {
                bottom: unset;
                left: unset;
                transform: none;
            }

            .picker-panel.dragging {
                transition: none !important;
                box-shadow: 0 16px 56px rgba(0, 0, 0, 0.7);
                border-color: rgba(0, 242, 254, 0.25);
            }

            .panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: grab;
                user-select: none;
                touch-action: none;
                gap: 16px;
            }

            .panel-header:active {
                cursor: grabbing;
            }

            .drag-hint {
                font-size: 10px;
                color: rgba(103, 232, 249, 0.8);
                letter-spacing: 0.3px;
                pointer-events: none;
                margin-left: 6px;
                border: 1px solid rgba(103, 232, 249, 0.2);
                border-radius: 999px;
                padding: 3px 7px;
                background: rgba(103, 232, 249, 0.08);
            }

            .title-area {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .logo-shield {
                width: 10px;
                height: 12px;
                background: linear-gradient(135deg, #00f2fe 0%, #7f00ff 100%);
                clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
            }

            h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 700;
                color: #ffffff;
                letter-spacing: 0.5px;
            }

            .selection-count {
                font-size: 11px;
                font-weight: 700;
                color: #67e8f9;
                background: rgba(103, 232, 249, 0.1);
                border: 1px solid rgba(103, 232, 249, 0.18);
                border-radius: 999px;
                padding: 3px 8px;
                white-space: nowrap;
            }

            .instruction {
                font-size: 11px;
                color: #94a3b8;
            }

            .selector-box {
                display: flex;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                padding: 8px 12px;
                align-items: center;
                gap: 8px;
            }

            .selector-input {
                background: transparent;
                border: none;
                color: #e2e8f0;
                font-family: monospace;
                font-size: 12px;
                width: 100%;
                outline: none;
            }

            .action-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 4px;
            }

            .control-group {
                display: flex;
                gap: 8px;
            }

            .btn {
                padding: 8px 14px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                white-space: nowrap;
            }

            .btn-primary {
                background: linear-gradient(135deg, #00f2fe 0%, #7f00ff 100%);
                color: #ffffff;
                box-shadow: 0 4px 10px rgba(0, 242, 254, 0.2);
            }

            .btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 14px rgba(0, 242, 254, 0.3);
            }

            .btn-secondary {
                background: rgba(255, 255, 255, 0.08);
                color: #e2e8f0;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
            }

            .btn-text {
                background: transparent;
                color: #94a3b8;
                padding: 8px 10px;
                font-weight: 500;
            }

            .btn-text:hover {
                color: #ffffff;
                text-decoration: underline;
            }

            /* Toggle Styles */
            .toggle-container {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                color: #94a3b8;
                cursor: pointer;
                user-select: none;
            }

            .toggle-switch {
                position: relative;
                width: 30px;
                height: 16px;
                background-color: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                transition: background-color 0.2s;
            }

            .toggle-switch::after {
                content: "";
                position: absolute;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background-color: #ffffff;
                top: 2px;
                left: 2px;
                transition: transform 0.2s;
            }

            .toggle-container.checked .toggle-switch {
                background: linear-gradient(135deg, #00f2fe 0%, #7f00ff 100%);
            }

            .toggle-container.checked .toggle-switch::after {
                transform: translateX(14px);
            }
        `;

        const outlineLayer = document.createElement("div");
        outlineLayer.id = "selected-outline-layer";
        outlineLayer.className = "selected-outline-layer";

        const container = document.createElement("div");
        container.id = "glassveil-panel";
        container.className = "picker-panel";
        pickerPanel = container;
        container.innerHTML = `
            <div class="panel-header" id="panel-drag-handle">
                <div class="title-area">
                    <div class="logo-shield"></div>
                    <h3>GlassVeil Picker</h3>
                    <span class="selection-count" id="selection-count">0 selected</span>
                    <span class="drag-hint">drag to move</span>
                </div>
                <span class="instruction" id="picker-instruction">Hover over elements and click to select</span>
            </div>
            <div class="selector-box">
                <input type="text" class="selector-input" id="selector-display" readonly placeholder="Hover element to inspect..." />
            </div>
            <div class="action-row">
                <div class="control-group">
                    <button class="btn btn-secondary btn-text" id="parent-btn" style="display: none;">Select Parent</button>
                    <div class="toggle-container" id="preview-toggle" style="display: none;">
                        <div class="toggle-switch"></div>
                        <span>Preview Hide</span>
                    </div>
                </div>
                <div class="control-group">
                    <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
                    <button class="btn btn-primary" id="confirm-btn" style="display: none;">Block Selected (0)</button>
                </div>
            </div>
        `;

        shadowRoot.appendChild(style);
        shadowRoot.appendChild(outlineLayer);
        shadowRoot.appendChild(container);

        // Trigger sliding entry animation on next tick
        setTimeout(() => {
            container.classList.add("active");
        }, 10);

        // ── Drag-to-move logic ──────────────────────────────────────────
        const dragHandle = shadowRoot.getElementById("panel-drag-handle");
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        const stopDragging = (e) => {
            if (!isDragging) return;
            isDragging = false;
            container.classList.remove("dragging");

            if (e.pointerId !== undefined && dragHandle.hasPointerCapture(e.pointerId)) {
                dragHandle.releasePointerCapture(e.pointerId);
            }
        };

        dragHandle.addEventListener("pointerdown", (e) => {
            // Only drag on left-button mouse input, while still supporting touch/stylus.
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (e.target.closest("button, input, a")) return;

            isDragging = true;

            // Convert panel to free (top/left) positioning on first drag
            const rect = container.getBoundingClientRect();
            container.classList.add("free", "dragging");
            container.style.top = rect.top + "px";
            container.style.left = rect.left + "px";

            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            dragHandle.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
        });

        dragHandle.addEventListener("pointermove", (e) => {
            if (!isDragging) return;

            const position = clampPanelPosition({
                left: e.clientX - dragOffsetX,
                top: e.clientY - dragOffsetY,
                panelWidth: container.offsetWidth,
                panelHeight: container.offsetHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
            });

            container.style.left = `${position.left}px`;
            container.style.top = `${position.top}px`;

            e.preventDefault();
            e.stopPropagation();
        });

        dragHandle.addEventListener("pointerup", stopDragging);
        dragHandle.addEventListener("pointercancel", stopDragging);
        dragHandle.addEventListener("lostpointercapture", stopDragging);
        // ── End drag logic ──────────────────────────────────────────────

        // Wire panel button listeners
        shadowRoot.getElementById("cancel-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            stopPicker();
        });

        shadowRoot.getElementById("parent-btn").addEventListener("click", handleSelectParent);
        shadowRoot.getElementById("confirm-btn").addEventListener("click", handleConfirmBlock);

        const previewToggle = shadowRoot.getElementById("preview-toggle");
        previewToggle.addEventListener("click", handleTogglePreview);
    };

    // Mouse Move Highlight Handlers
    const handleMouseOver = (e) => {
        if (!isPickerActive) return;

        const el = e.target;

        // Ignore html, body, and picker elements
        if (el === document.documentElement || el === document.body || pickerRoot.contains(el)) {
            return;
        }

        if (hoveredElement && hoveredElement !== el) {
            hoveredElement.classList.remove("glassveil-picker-hovered");
        }

        hoveredElement = el;
        if (!selectedElements.has(hoveredElement)) {
            hoveredElement.classList.add("glassveil-picker-hovered");
        }

        // Generate real-time CSS selector
        const selector = generateSelector(hoveredElement);
        const displayInput = shadowRoot.getElementById("selector-display");
        if (displayInput && selectedElements.size === 0) {
            displayInput.value = selector;
        }
    };

    const handleMouseOut = (e) => {
        if (!isPickerActive) return;

        if (hoveredElement && e.target === hoveredElement) {
            if (!selectedElements.has(hoveredElement)) {
                hoveredElement.classList.remove("glassveil-picker-hovered");
            }
            hoveredElement = null;

            const displayInput = shadowRoot.getElementById("selector-display");
            if (displayInput && selectedElements.size === 0) {
                displayInput.value = "";
            }
        }
    };

    // Click handler to toggle one element in the current selection
    const handleElementClick = (e) => {
        if (!isPickerActive) return;

        // Check if clicked inside our Shadow DOM panel BEFORE stopping propagation.
        // composedPath() lets us see through Shadow DOM boundaries correctly.
        const path = e.composedPath();
        if (path.includes(pickerRoot)) {
            return;
        }

        // Prevent navigating or click effects on page elements only
        e.preventDefault();
        e.stopPropagation();

        const targetElement = e.target;

        if (hoveredElement === targetElement) {
            targetElement.classList.remove("glassveil-picker-hovered");
            hoveredElement = null;
        }

        if (selectedElements.has(targetElement)) {
            selectedElements.delete(targetElement);
            targetElement.classList.remove("glassveil-picker-hovered", "glassveil-picker-selected");
            restorePreviewForElement(targetElement);

            if (activeSelectedElement === targetElement) {
                const remainingSelection = Array.from(selectedElements);
                activeSelectedElement = remainingSelection[remainingSelection.length - 1] || null;
            }
        } else {
            selectedElements.add(targetElement);
            activeSelectedElement = targetElement;
            targetElement.classList.remove("glassveil-picker-hovered");
            targetElement.classList.add("glassveil-picker-selected");

            if (isPreviewEnabled()) {
                previewElement(targetElement);
            }
        }

        updateSelectionControls();
    };

    // Keyboard shortcut handlers (Escape to cancel)
    const handleKeyDown = (e) => {
        if (e.key === "Escape") {
            stopPicker();
        }
    };

    // Action Bar Controller functions
    const handleSelectParent = (e) => {
        e.stopPropagation();
        if (!activeSelectedElement) return;

        const currentElement = activeSelectedElement;
        const parent = currentElement.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) {
            alert("Cannot select parent any further.");
            return;
        }

        selectedElements.delete(currentElement);
        currentElement.classList.remove("glassveil-picker-hovered", "glassveil-picker-selected");
        restorePreviewForElement(currentElement);

        // Set parent as the new selected element
        activeSelectedElement = parent;
        selectedElements.add(parent);
        parent.classList.remove("glassveil-picker-hovered");
        parent.classList.add("glassveil-picker-selected");

        if (isPreviewEnabled()) {
            previewElement(parent);
        }

        updateSelectionControls();
    };

    const handleTogglePreview = (e) => {
        e.stopPropagation();
        if (selectedElements.size === 0) return;

        const toggle = shadowRoot.getElementById("preview-toggle");
        const isChecked = toggle.classList.toggle("checked");

        if (isChecked) {
            applyPreviewToSelection();
        } else {
            restorePreview();
        }

        syncSelectedOutlines();
    };

    const handleConfirmBlock = async (e) => {
        e.stopPropagation();
        if (selectedElements.size === 0) return;

        const selectedSelectors = Array.from(selectedElements)
            .map(generateSelector)
            .filter(Boolean);

        if (selectedSelectors.length === 0) return;

        console.log("[GlassVeil] Confirming block for selectors:", selectedSelectors);

        try {
            // Save selectors to storage
            const { rules = {} } = await chrome.storage.local.get("rules");
            const siteRules = rules[currentDomain] || [];
            const mergedSiteRules = mergeUniqueSelectors(siteRules, selectedSelectors);

            if (mergedSiteRules.length !== siteRules.length) {
                rules[currentDomain] = mergedSiteRules;
                await chrome.storage.local.set({ rules });
                console.log("[GlassVeil] Rules successfully saved to local storage.");
            } else {
                console.log("[GlassVeil] Selected rules already exist in local storage.");
            }

            // Apply rules immediately in the active session
            activeSelectors = mergedSiteRules;
            applyRules(activeSelectors, isBlockerEnabled);
        } catch (err) {
            console.error("[GlassVeil] Error saving/applying rules:", err);
        }

        // Clean up picker and stop
        stopPicker();
    };

    // ==========================================
    // CSS SELECTOR GENERATION LOGIC
    // ==========================================
    const generateSelector = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";

        const path = [];
        let current = el;
        let depth = 0;

        while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
            let tagName = current.nodeName.toLowerCase();

            // Stop walking up if we hit body or html
            if (tagName === "body" || tagName === "html") {
                if (path.length === 0) path.unshift(tagName);
                break;
            }

            // Check for clean ID
            if (current.id) {
                const cleanId = current.id.trim();
                // Skip IDs that look dynamic: e.g. containing numbers >= 4 digits, random hashes
                const isDynamic = /\d{4,}/.test(cleanId) || /^[a-f0-9]{8,}$/i.test(cleanId) || cleanId.startsWith("react-") || cleanId.startsWith("vue-") || cleanId.startsWith("ember") || cleanId.includes("_tmp");

                if (!isDynamic) {
                    try {
                        const escapedId = CSS.escape(cleanId);
                        // Verify if ID is unique in document
                        if (document.querySelectorAll(`#${escapedId}`).length === 1) {
                            path.unshift(`#${escapedId}`);
                            break; // Unique ID is an absolute selector, stop climbing
                        }
                    } catch (err) {
                        console.warn("Invalid ID character found while escaping:", cleanId);
                    }
                }
            }

            // Get clean classes
            let classSelector = "";
            const rawClasses = [];

            if (current.classList && current.classList.length > 0) {
                for (let i = 0; i < current.classList.length; i++) {
                    const cls = current.classList[i];

                    if (
                        isPickerStateClass(cls) ||
                        /\d{4,}/.test(cls) ||
                        cls.length > 25 ||
                        cls.includes("_") ||
                        cls.includes("-") && /\d/.test(cls)
                    ) {
                        continue;
                    }

                    rawClasses.push(cls);
                }

                if (rawClasses.length > 0) {
                    classSelector = "." + rawClasses.map(cls => CSS.escape(cls)).join(".");
                }
            }

            const segment = tagName + classSelector;

            // Check if tag + classes uniquely identifies element among siblings
            const siblings = current.parentElement ? Array.from(current.parentElement.children) : [];
            const matchingSiblings = siblings.filter(sib => {
                let sibTagName = sib.nodeName.toLowerCase();
                if (sibTagName !== tagName) return false;

                if (classSelector) {
                    return rawClasses.every(cls => sib.classList.contains(cls));
                }
                return true;
            });

            if (matchingSiblings.length > 1 && current.parentElement) {
                // Not unique among siblings, add nth-of-type
                const index = siblings.indexOf(current) + 1;
                path.unshift(`${segment}:nth-child(${index})`);
            } else {
                path.unshift(segment);
            }

            current = current.parentElement;
            depth++;
        }

        return path.join(" > ");
    };

})();
}
