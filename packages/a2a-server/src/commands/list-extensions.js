/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { listExtensions } from '@google/gemini-cli-core';
export class ListExtensionsCommand {
    names = ['extensions', 'extensions list'];
    async execute(config, _) {
        return listExtensions(config);
    }
}
//# sourceMappingURL=list-extensions.js.map