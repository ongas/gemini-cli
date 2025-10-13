/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
export function detectIndentationStyle(content) {
  const lines = content.split('\n');
  const spaceCounts = {};
  let tabCount = 0;
  for (const line of lines) {
    if (line.trim() === '') continue; // Skip empty lines
    const leadingWhitespace = line.match(/^(\s+)/);
    if (!leadingWhitespace) continue;
    const whitespace = leadingWhitespace[1];
    if (whitespace[0] === '\t') {
      tabCount++;
    } else {
      // Count leading spaces
      const spaceCount = whitespace.length;
      spaceCounts[spaceCount] = (spaceCounts[spaceCount] || 0) + 1;
    }
  }
  // If tabs are more common, use tabs
  if (tabCount > Object.values(spaceCounts).reduce((a, b) => a + b, 0)) {
    return { char: '\t', size: 1 };
  }
  // Otherwise, find the most common space indentation
  // Usually it's 2 or 4 spaces
  const commonIndents = [2, 4, 3, 8];
  for (const indent of commonIndents) {
    if (
      spaceCounts[indent] ||
      spaceCounts[indent * 2] ||
      spaceCounts[indent * 3]
    ) {
      return { char: ' ', size: indent };
    }
  }
  // Default to 4 spaces if we can't detect
  return { char: ' ', size: 4 };
}
/**
 * Normalizes the indentation of a string to match the target style.
 * @param text The text to normalize
 * @param targetStyle The target indentation style
 * @returns The normalized text
 */
export function normalizeIndentation(text, targetStyle) {
  const lines = text.split('\n');
  const sourceStyle = detectIndentationStyle(text);
  // If already using the same style, return as-is
  if (
    sourceStyle.char === targetStyle.char &&
    sourceStyle.size === targetStyle.size
  ) {
    return text;
  }
  const normalizedLines = lines.map((line) => {
    if (line.trim() === '') return line; // Preserve empty lines
    const leadingWhitespace = line.match(/^(\s+)/);
    if (!leadingWhitespace) return line; // No indentation to fix
    const whitespace = leadingWhitespace[1];
    const content = line.slice(whitespace.length);
    // Calculate the indentation level
    let indentLevel;
    if (sourceStyle.char === '\t') {
      indentLevel = whitespace.split('\t').length - 1;
    } else {
      indentLevel = Math.floor(whitespace.length / sourceStyle.size);
    }
    // Generate the new indentation
    const newIndent =
      targetStyle.char === '\t'
        ? '\t'.repeat(indentLevel)
        : ' '.repeat(indentLevel * targetStyle.size);
    return newIndent + content;
  });
  return normalizedLines.join('\n');
}
/**
 * Validates Python syntax by running Python's AST parser.
 * This is fast and doesn't require executing the code.
 * @param code The Python code to validate
 * @param timeout Timeout in milliseconds (default: 500ms)
 * @returns null if valid, error message if invalid
 */
export async function validatePythonSyntax(code, timeout = 500) {
  return new Promise((resolve) => {
    const pythonProcess = spawn(
      'python3',
      ['-c', `import ast; ast.parse(${JSON.stringify(code)})`],
      {
        timeout,
        stdio: ['ignore', 'ignore', 'pipe'], // Only capture stderr
      },
    );
    let stderr = '';
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        resolve(null); // Valid Python syntax
      } else {
        // Extract just the error type and message (first line usually)
        const errorLine = stderr
          .split('\n')
          .find(
            (line) =>
              line.includes('Error:') ||
              line.includes('SyntaxError') ||
              line.includes('IndentationError'),
          );
        resolve(errorLine || 'Python syntax error');
      }
    });
    pythonProcess.on('error', (err) => {
      // Python not installed or other spawn error
      console.warn('Could not validate Python syntax:', err.message);
      resolve(null); // Don't block edits if Python validation fails
    });
  });
}
/**
 * Auto-fixes Python indentation errors by trying common corrections.
 * @param code The Python code with potential indentation errors
 * @param fileIndentStyle The indentation style used in the file
 * @returns The fixed code if possible, or the original code if unfixable
 */
export async function tryFixPythonIndentation(code, fileIndentStyle) {
  // First, try normalizing to the file's indentation style
  const normalized = normalizeIndentation(code, fileIndentStyle);
  const normalizedError = await validatePythonSyntax(normalized);
  if (!normalizedError) {
    return normalized; // Fixed!
  }
  // Try dedenting by one level (common issue: LLM over-indents)
  const dedented = code
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line;
      if (fileIndentStyle.char === '\t') {
        return line.replace(/^\t/, '');
      } else {
        return line.replace(new RegExp(`^ {${fileIndentStyle.size}}`), '');
      }
    })
    .join('\n');
  const dedentedError = await validatePythonSyntax(dedented);
  if (!dedentedError) {
    return dedented; // Fixed by dedenting!
  }
  // Could add more heuristics here (e.g., indent by one level, fix mixed tabs/spaces)
  // But for now, return original and let LLM correction handle it
  return code;
}
//# sourceMappingURL=indentationNormalizer.js.map
