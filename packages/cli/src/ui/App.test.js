import { jsx as _jsx } from 'react/jsx-runtime';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { App } from './App.js';
import { UIStateContext } from './contexts/UIStateContext.js';
import { StreamingState } from './types.js';
vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    useIsScreenReaderEnabled: vi.fn(),
  };
});
vi.mock('./components/MainContent.js', () => ({
  MainContent: () => _jsx(Text, { children: 'MainContent' }),
}));
vi.mock('./components/DialogManager.js', () => ({
  DialogManager: () => _jsx(Text, { children: 'DialogManager' }),
}));
vi.mock('./components/Composer.js', () => ({
  Composer: () => _jsx(Text, { children: 'Composer' }),
}));
vi.mock('./components/Notifications.js', () => ({
  Notifications: () => _jsx(Text, { children: 'Notifications' }),
}));
vi.mock('./components/QuittingDisplay.js', () => ({
  QuittingDisplay: () => _jsx(Text, { children: 'Quitting...' }),
}));
vi.mock('./components/Footer.js', () => ({
  Footer: () => _jsx(Text, { children: 'Footer' }),
}));
describe('App', () => {
  const mockUIState = {
    streamingState: StreamingState.Idle,
    quittingMessages: null,
    dialogsVisible: false,
    mainControlsRef: { current: null },
    historyManager: {
      addItem: vi.fn(),
      history: [],
      updateItem: vi.fn(),
      clearItems: vi.fn(),
      loadHistory: vi.fn(),
    },
  };
  it('should render main content and composer when not quitting', () => {
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: mockUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('MainContent');
    expect(lastFrame()).toContain('Notifications');
    expect(lastFrame()).toContain('Composer');
  });
  it('should render quitting display when quittingMessages is set', () => {
    const quittingUIState = {
      ...mockUIState,
      quittingMessages: [{ id: 1, type: 'user', text: 'test' }],
    };
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: quittingUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('Quitting...');
  });
  it('should render dialog manager when dialogs are visible', () => {
    const dialogUIState = {
      ...mockUIState,
      dialogsVisible: true,
    };
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: dialogUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('MainContent');
    expect(lastFrame()).toContain('Notifications');
    expect(lastFrame()).toContain('DialogManager');
  });
  it('should show Ctrl+C exit prompt when dialogs are visible and ctrlCPressedOnce is true', () => {
    const ctrlCUIState = {
      ...mockUIState,
      dialogsVisible: true,
      ctrlCPressedOnce: true,
    };
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: ctrlCUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('Press Ctrl+C again to exit.');
  });
  it('should show Ctrl+D exit prompt when dialogs are visible and ctrlDPressedOnce is true', () => {
    const ctrlDUIState = {
      ...mockUIState,
      dialogsVisible: true,
      ctrlDPressedOnce: true,
    };
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: ctrlDUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('Press Ctrl+D again to exit.');
  });
  it('should render ScreenReaderAppLayout when screen reader is enabled', () => {
    useIsScreenReaderEnabled.mockReturnValue(true);
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: mockUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain(
      'Notifications\nFooter\nMainContent\nComposer',
    );
  });
  it('should render DefaultAppLayout when screen reader is not enabled', () => {
    useIsScreenReaderEnabled.mockReturnValue(false);
    const { lastFrame } = render(
      _jsx(UIStateContext.Provider, {
        value: mockUIState,
        children: _jsx(App, {}),
      }),
    );
    expect(lastFrame()).toContain('MainContent\nNotifications\nComposer');
  });
});
//# sourceMappingURL=App.test.js.map
