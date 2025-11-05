/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Detects the indentation style used in a file.
 * @returns An object with indentation character ('\t' or ' ') and size (e.g., 2, 4)
 */
export interface IndentationStyle {
    char: '\t' | ' ';
    size: number;
}
export declare function detectIndentationStyle(content: string): IndentationStyle;
/**
 * Normalizes the indentation of a string to match the target style.
 * @param text The text to normalize
 * @param targetStyle The target indentation style
 * @returns The normalized text
 */
export declare function normalizeIndentation(text: string, targetStyle: IndentationStyle): string;
/**
 * Validates Python syntax by running Python's AST parser.
 * This is fast and doesn't require executing the code.
 * @param code The Python code to validate
 * @param timeout Timeout in milliseconds (default: 500ms)
 * @returns null if valid, error message if invalid
 */
export declare function validatePythonSyntax(code: string, timeout?: number): Promise<string | null>;
/**
 * Auto-fixes Python indentation errors by trying common corrections.
 * @param code The Python code with potential indentation errors
 * @param fileIndentStyle The indentation style used in the file
 * @returns The fixed code if possible, or the original code if unfixable
 */
export declare function tryFixPythonIndentation(code: string, fileIndentStyle: IndentationStyle): Promise<string>;
