/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FileFilteringOptions, GeminiCLIExtension } from '@google/gemini-cli-core';
import { Config, FileDiscoveryService } from '@google/gemini-cli-core';
import type { Settings } from './settings.js';
export interface CliArgs {
    query: string | undefined;
    model: string | undefined;
    sandbox: boolean | string | undefined;
    debug: boolean | undefined;
    prompt: string | undefined;
    promptInteractive: string | undefined;
    yolo: boolean | undefined;
    approvalMode: string | undefined;
    allowedMcpServerNames: string[] | undefined;
    allowedTools: string[] | undefined;
    experimentalAcp: boolean | undefined;
    extensions: string[] | undefined;
    listExtensions: boolean | undefined;
    includeDirectories: string[] | undefined;
    screenReader: boolean | undefined;
    useSmartEdit: boolean | undefined;
    useWriteTodos: boolean | undefined;
    outputFormat: string | undefined;
    fakeResponses: string | undefined;
}
export declare function parseArguments(settings: Settings): Promise<CliArgs>;
export declare function loadHierarchicalGeminiMemory(currentWorkingDirectory: string, includeDirectoriesToReadGemini: readonly string[] | undefined, debugMode: boolean, fileService: FileDiscoveryService, settings: Settings, extensions: GeminiCLIExtension[], folderTrust: boolean, memoryImportFormat?: 'flat' | 'tree', fileFilteringOptions?: FileFilteringOptions): Promise<{
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
}>;
export declare function isDebugMode(argv: CliArgs): boolean;
export declare function loadCliConfig(settings: Settings, allExtensions: GeminiCLIExtension[], sessionId: string, argv: CliArgs, cwd?: string): Promise<Config>;
