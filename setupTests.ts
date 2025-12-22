// Vitest setup - no jest-dom needed

// DOM API used these for advanced pointer interactions, and it's only available in real browsers — not in jsdom
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (): boolean => false;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = (): void => {
    // Intentionally left blank for testing environment
  };
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = (): void => {
    // Intentionally left blank for testing environment
  };
}
