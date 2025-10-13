/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
interface MatchResult {
    startLine: number;
    endLine: number;
    fileIndent: number;
    adjustedNewString: string;
}
/**
 * Attempts to find a match for oldString in fileContent with flexible indentation.
 * If found, returns the match location and an adjusted newString with correct indentation.
 *
 * This is specifically designed for Python where relative indentation matters but
 * absolute indentation can vary.
 */
export declare function findPythonMatchWithFlexibleIndentation(fileContent: string, oldString: string, newString: string, debug?: boolean): MatchResult | null;
/**
 * Checks if a file is likely a Python file based on its path.
 */
export declare function isPythonFile(filePath: string): boolean;
/**
 * Applies the match result to get the actual old_string and new_string
 * that should be used for the replacement.
 */
export declare function applyPythonMatch(fileContent: string, matchResult: MatchResult): {
    actualOldString: string;
    actualNewString: string;
};
export {};
