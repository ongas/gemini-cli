/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeminiCLIExtension } from '@google/gemini-cli-core';
import { ExtensionUpdateState } from '../state/extensions.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { type ConfirmationRequest } from '../types.js';
import type { ExtensionManager } from '../../config/extension-manager.js';
type ConfirmationRequestWrapper = {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
};
type ConfirmationRequestAction = {
    type: 'add';
    request: ConfirmationRequestWrapper;
} | {
    type: 'remove';
    request: ConfirmationRequestWrapper;
};
export declare const useConfirmUpdateRequests: () => {
    addConfirmUpdateExtensionRequest: (original: ConfirmationRequest) => void;
    confirmUpdateExtensionRequests: ConfirmationRequestWrapper[];
    dispatchConfirmUpdateExtensionRequests: import("react").ActionDispatch<[action: ConfirmationRequestAction]>;
};
export declare const useExtensionUpdates: (extensions: GeminiCLIExtension[], extensionManager: ExtensionManager, addItem: UseHistoryManagerReturn["addItem"]) => {
    extensionsUpdateState: Map<string, ExtensionUpdateState>;
    extensionsUpdateStateInternal: Map<string, import("../state/extensions.js").ExtensionUpdateStatus>;
    dispatchExtensionStateUpdate: import("react").ActionDispatch<[action: import("../state/extensions.js").ExtensionUpdateAction]>;
};
export {};
