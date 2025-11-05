import { jsx as _jsx } from "react/jsx-runtime";
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from 'ink-testing-library';
import { LoadedSettings } from '../config/settings.js';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { ShellFocusContext } from '../ui/contexts/ShellFocusContext.js';
import { UIStateContext } from '../ui/contexts/UIStateContext.js';
import { StreamingState } from '../ui/types.js';
import { ConfigContext } from '../ui/contexts/ConfigContext.js';
import { calculateMainAreaWidth } from '../ui/utils/ui-sizing.js';
import { VimModeProvider } from '../ui/contexts/VimModeContext.js';
import {} from '@google/gemini-cli-core';
const mockConfig = {
    getModel: () => 'gemini-pro',
    getTargetDir: () => '/Users/test/project/foo/bar/and/some/more/directories/to/make/it/long',
    getDebugMode: () => false,
};
const configProxy = new Proxy(mockConfig, {
    get(target, prop) {
        if (prop in target) {
            return target[prop];
        }
        throw new Error(`mockConfig does not have property ${String(prop)}`);
    },
});
export const mockSettings = new LoadedSettings({ path: '', settings: {}, originalSettings: {} }, { path: '', settings: {}, originalSettings: {} }, { path: '', settings: {}, originalSettings: {} }, { path: '', settings: {}, originalSettings: {} }, true, new Set());
export const createMockSettings = (overrides) => {
    const settings = overrides;
    return new LoadedSettings({ path: '', settings: {}, originalSettings: {} }, { path: '', settings: {}, originalSettings: {} }, { path: '', settings, originalSettings: settings }, { path: '', settings: {}, originalSettings: {} }, true, new Set());
};
// A minimal mock UIState to satisfy the context provider.
// Tests that need specific UIState values should provide their own.
const baseMockUiState = {
    renderMarkdown: true,
    streamingState: StreamingState.Idle,
    mainAreaWidth: 100,
    terminalWidth: 120,
};
export const renderWithProviders = (component, { shellFocus = true, settings = mockSettings, uiState: providedUiState, width, kittyProtocolEnabled = true, config = configProxy, } = {}) => {
    const baseState = new Proxy({ ...baseMockUiState, ...providedUiState }, {
        get(target, prop) {
            if (prop in target) {
                return target[prop];
            }
            // For properties not in the base mock or provided state,
            // we'll check the original proxy to see if it's a defined but
            // unprovided property, and if not, throw.
            if (prop in baseMockUiState) {
                return baseMockUiState[prop];
            }
            throw new Error(`mockUiState does not have property ${String(prop)}`);
        },
    });
    const terminalWidth = width ?? baseState.terminalWidth;
    const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);
    const finalUiState = {
        ...baseState,
        terminalWidth,
        mainAreaWidth,
    };
    return render(_jsx(ConfigContext.Provider, { value: config, children: _jsx(SettingsContext.Provider, { value: settings, children: _jsx(UIStateContext.Provider, { value: finalUiState, children: _jsx(VimModeProvider, { settings: settings, children: _jsx(ShellFocusContext.Provider, { value: shellFocus, children: _jsx(KeypressProvider, { kittyProtocolEnabled: kittyProtocolEnabled, children: component }) }) }) }) }) }));
};
//# sourceMappingURL=render.js.map