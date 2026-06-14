const assert = require("node:assert/strict");
const test = require("node:test");

const {
    isPickerStateClass,
    formatSelectedOutlineLabel,
    clampPanelPosition,
    mergeUniqueSelectors,
    formatConfirmButtonLabel,
    formatSelectionSummary
} = require("../content/content.js");

test("isPickerStateClass ignores temporary picker classes during selector generation", () => {
    assert.equal(isPickerStateClass("glassveil-picker-hovered"), true);
    assert.equal(isPickerStateClass("glassveil-picker-selected"), true);
    assert.equal(isPickerStateClass("sponsored-card"), false);
});

test("formatSelectedOutlineLabel numbers selected elements from one", () => {
    assert.equal(formatSelectedOutlineLabel(0), "1");
    assert.equal(formatSelectedOutlineLabel(4), "5");
});

test("clampPanelPosition keeps the picker panel inside the viewport", () => {
    assert.deepEqual(clampPanelPosition({
        left: -24,
        top: 800,
        panelWidth: 320,
        panelHeight: 120,
        viewportWidth: 1024,
        viewportHeight: 768
    }), {
        left: 0,
        top: 648
    });
});

test("clampPanelPosition handles panels wider than the viewport", () => {
    assert.deepEqual(clampPanelPosition({
        left: 40,
        top: 20,
        panelWidth: 1200,
        panelHeight: 180,
        viewportWidth: 800,
        viewportHeight: 600
    }), {
        left: 0,
        top: 20
    });
});

test("mergeUniqueSelectors keeps existing selectors and appends new unique ones", () => {
    const mergedSelectors = mergeUniqueSelectors(
        [".ad-slot", "#sponsor"],
        ["#sponsor", "  .sidebar-ad  ", "", null, ".promo-card"]
    );

    assert.deepEqual(mergedSelectors, [".ad-slot", "#sponsor", ".sidebar-ad", ".promo-card"]);
});

test("mergeUniqueSelectors does not mutate the existing selector list", () => {
    const existingSelectors = [".ad-slot"];

    const mergedSelectors = mergeUniqueSelectors(existingSelectors, [".banner"]);

    assert.deepEqual(existingSelectors, [".ad-slot"]);
    assert.deepEqual(mergedSelectors, [".ad-slot", ".banner"]);
});

test("formatConfirmButtonLabel includes the current selected count", () => {
    assert.equal(formatConfirmButtonLabel(1), "Block Selected (1)");
    assert.equal(formatConfirmButtonLabel(3), "Block Selected (3)");
});

test("formatSelectionSummary preserves single selector detail and summarizes multiples", () => {
    assert.equal(formatSelectionSummary(0, ".ad-slot"), "");
    assert.equal(formatSelectionSummary(1, ".ad-slot"), ".ad-slot");
    assert.equal(formatSelectionSummary(1), "1 element selected");
    assert.equal(formatSelectionSummary(4, ".ad-slot"), "4 elements selected");
});
