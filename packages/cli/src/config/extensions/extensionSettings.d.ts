/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExtensionStorage } from './storage.js';
import type { ExtensionConfig } from '../extension.js';
export interface ExtensionSetting {
    name: string;
    description: string;
    envVar: string;
}
export declare function maybePromptForSettings(extensionConfig: ExtensionConfig, requestSetting: (setting: ExtensionSetting) => Promise<string>, previousExtensionConfig?: ExtensionConfig, previousSettings?: Record<string, string>): Promise<void>;
export declare function promptForSetting(setting: ExtensionSetting): Promise<string>;
export declare function getEnvContents(extensionStorage: ExtensionStorage): Record<string, string>;
