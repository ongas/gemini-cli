/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@google/gemini-cli-core';
export interface Command {
    readonly names: string[];
    execute(config: Config, args: string[]): Promise<unknown>;
}
declare class CommandRegistry {
    private readonly commands;
    constructor();
    register(command: Command): void;
    get(commandName: string): Command | undefined;
}
export declare const commandRegistry: CommandRegistry;
export {};
