/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { UpdateInfo } from 'update-notifier';
import type { LoadedSettings } from '../../config/settings.js';
export declare const FETCH_TIMEOUT_MS = 2000;
export interface UpdateObject {
    message: string;
    update: UpdateInfo;
}
export declare function checkForUpdates(settings: LoadedSettings): Promise<UpdateObject | null>;
