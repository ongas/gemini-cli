/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { MarkdownAgentLoader } from './markdown-agent-loader.js';
describe('MarkdownAgentLoader', () => {
    describe('parseMarkdownAgent', () => {
        it('should parse tools from **Tools:** line', () => {
            const markdown = `# Test Agent

Agent description here.

**Tools:** read_file, glob, search_file_content

## Core Responsibilities

Do stuff.
`;
            const agent = MarkdownAgentLoader.parseMarkdownAgent(markdown, 'test-agent.md', false);
            expect(agent).toBeDefined();
            expect(agent?.name).toBe('test_agent');
            expect(agent?.displayName).toBe('Test Agent');
            expect(agent?.toolConfig).toBeDefined();
            expect(agent?.toolConfig?.tools).toEqual([
                'read_file',
                'glob',
                'search_file_content',
            ]);
        });
        it('should handle no tools specification', () => {
            const markdown = `# Test Agent

Agent description here.

## Core Responsibilities

Do stuff.
`;
            const agent = MarkdownAgentLoader.parseMarkdownAgent(markdown, 'test-agent.md', false);
            expect(agent).toBeDefined();
            expect(agent?.toolConfig).toBeUndefined();
        });
        it('should handle tools with extra whitespace', () => {
            const markdown = `# Test Agent

Agent description.

**Tools:**  read_file ,  write_file  ,  glob

## Instructions
`;
            const agent = MarkdownAgentLoader.parseMarkdownAgent(markdown, 'test-agent.md', false);
            expect(agent?.toolConfig?.tools).toEqual([
                'read_file',
                'write_file',
                'glob',
            ]);
        });
        it('should be case-insensitive for **Tools:** keyword', () => {
            const markdown = `# Test Agent

Description.

**tools:** read_file, glob

## Instructions
`;
            const agent = MarkdownAgentLoader.parseMarkdownAgent(markdown, 'test-agent.md', false);
            expect(agent?.toolConfig?.tools).toEqual(['read_file', 'glob']);
        });
    });
});
//# sourceMappingURL=markdown-agent-loader.test.js.map