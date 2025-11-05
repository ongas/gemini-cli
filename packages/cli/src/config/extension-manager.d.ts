/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type LoadedSettings, SettingScope } from './settings.js';
import { type ExtensionConfig } from './extension.js';
import { type ExtensionInstallMetadata, type GeminiCLIExtension } from '@google/gemini-cli-core';
import { type ExtensionSetting } from './extensions/extensionSettings.js';
interface ExtensionManagerParams {
    enabledExtensionOverrides?: string[];
    loadedSettings: LoadedSettings;
    requestConsent: (consent: string) => Promise<boolean>;
    requestSetting: ((setting: ExtensionSetting) => Promise<string>) | null;
    workspaceDir: string;
}
export declare class ExtensionManager {
    private extensionEnablementManager;
    private loadedSettings;
    private requestConsent;
    private requestSetting;
    private telemetryConfig;
    private workspaceDir;
    constructor(options: ExtensionManagerParams);
    installOrUpdateExtension(installMetadata: ExtensionInstallMetadata, previousExtensionConfig?: ExtensionConfig): Promise<string>;
    uninstallExtension(extensionIdentifier: string, isUpdate: boolean): Promise<void>;
    loadExtensions(): GeminiCLIExtension[];
    loadExtension(extensionDir: string): GeminiCLIExtension | null;
    loadExtensionByName(name: string): GeminiCLIExtension | null;
    loadExtensionConfig(extensionDir: string): ExtensionConfig;
    toOutputString(extension: GeminiCLIExtension): string;
    disableExtension(name: string, scope: SettingScope): void;
    enableExtension(name: string, scope: SettingScope): void;
}
export declare function copyExtension(source: string, destination: string): Promise<void>;
export declare function getExtensionId(config: ExtensionConfig, installMetadata?: ExtensionInstallMetadata): string;
export declare function hashValue(value: string): string;
export {};
