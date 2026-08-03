import { vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';

// Make fake browser available globally as `browser` and `chrome`
vi.stubGlobal('browser', fakeBrowser);
vi.stubGlobal('chrome', fakeBrowser);

// Reset fake browser state between tests
beforeEach(() => {
  fakeBrowser.reset();
});
