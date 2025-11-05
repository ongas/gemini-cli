/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from 'ink-testing-library';
import type React from 'react';
import { LoadedSettings, type Settings } from '../config/settings.js';
import { type UIState } from '../ui/contexts/UIStateContext.js';
import { type Config } from '@google/gemini-cli-core';
export declare const mockSettings: LoadedSettings;
export declare const createMockSettings: (overrides: Partial<Settings>) => LoadedSettings;
export declare const renderWithProviders: (component: React.ReactElement, { shellFocus, settings, uiState: providedUiState, width, kittyProtocolEnabled, config, }?: {
    shellFocus?: boolean;
    settings?: LoadedSettings;
    uiState?: Partial<UIState>;
    width?: number;
    kittyProtocolEnabled?: boolean;
    config?: Config;
}) => ReturnType<typeof render>;
