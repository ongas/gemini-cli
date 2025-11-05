/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { FileFilteringOptions } from '../config/constants.js';
import type { GeminiCLIExtension } from '../config/config.js';
export interface LoadServerHierarchicalMemoryResponse {
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
}
/**
 * Loads hierarchical GEMINI.md files and concatenates their content.
 * This function is intended for use by the server.
 */
export declare function loadServerHierarchicalMemory(currentWorkingDirectory: string, includeDirectoriesToReadGemini: readonly string[], debugMode: boolean, fileService: FileDiscoveryService, extensions: GeminiCLIExtension[], folderTrust: boolean, importFormat?: 'flat' | 'tree', fileFilteringOptions?: FileFilteringOptions, maxDirs?: number): Promise<LoadServerHierarchicalMemoryResponse>;
