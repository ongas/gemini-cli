/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Config } from '@google/gemini-cli-core';
import type { Command } from './command-registry.js';
export declare class ListExtensionsCommand implements Command {
    readonly names: string[];
    execute(config: Config, _: string[]): Promise<unknown>;
}
