/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config } from '@google/gemini-cli-core';
import type { Settings } from './settings.js';
import type { Extension } from './extension.js';
import { type AgentSettings } from '../types.js';
export declare function loadConfig(settings: Settings, extensions: Extension[], taskId: string): Promise<Config>;
export declare function mergeMcpServers(settings: Settings, extensions: Extension[]): {
    [x: string]: import("@google/gemini-cli-core").MCPServerConfig;
};
export declare function setTargetDir(agentSettings: AgentSettings | undefined): string;
export declare function loadEnvironment(): void;
