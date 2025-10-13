/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { MessageType } from '../types.js';
import { CommandKind } from './types.js';
export const cleanupContextCommand = {
    name: 'cleanup-context',
    altNames: ['cleanup', 'trim-context'],
    description: 'Aggressively cleans up conversation context by removing old tool results and trimming history. Keeps only recent conversation turns.',
    kind: CommandKind.BUILT_IN,
    action: async (context) => {
        const { ui } = context;
        try {
            const client = context.services.config?.getGeminiClient();
            if (!client) {
                ui.addItem({
                    type: MessageType.ERROR,
                    text: 'Chat client not available.',
                }, Date.now());
                return;
            }
            const historyBefore = client.getHistory();
            const tokensBefore = estimateTokens(historyBefore);
            // Get current history
            const history = client.getHistory();
            if (history.length === 0) {
                ui.addItem({
                    type: MessageType.INFO,
                    text: 'No conversation history to clean up.',
                }, Date.now());
                return;
            }
            // Strategy: Keep only last 6 content items (roughly 3 user-model turn pairs)
            // This is more aggressive than the automatic trimming (which keeps last 4)
            const keepCount = Math.min(6, history.length);
            const trimmedHistory = history.slice(-keepCount);
            // Also trim any remaining large tool results in the kept history
            const cleanedHistory = trimmedHistory.map((content) => {
                if (content.role !== 'user' || !content.parts) {
                    return content;
                }
                const cleanedParts = content.parts.map((part) => {
                    if (!part.functionResponse) {
                        return part;
                    }
                    const response = part.functionResponse.response;
                    const output = response?.output;
                    if (typeof output !== 'string' || output.length < 500) {
                        return part; // Keep small outputs
                    }
                    // Trim to brief summary
                    const toolName = part.functionResponse.name || 'unknown_tool';
                    const summary = `[Cleaned up: ${toolName} output (${output.length} chars)]`;
                    return {
                        functionResponse: {
                            ...part.functionResponse,
                            response: { output: summary },
                        },
                    };
                });
                return {
                    ...content,
                    parts: cleanedParts,
                };
            });
            // Update history
            client.setHistory(cleanedHistory);
            const tokensAfter = estimateTokens(cleanedHistory);
            const tokensSaved = tokensBefore - tokensAfter;
            const turnsRemoved = Math.floor((history.length - cleanedHistory.length) / 2);
            ui.addItem({
                type: MessageType.INFO,
                text: `✅ Context cleaned up:\n  • Removed ${turnsRemoved} older conversation turn(s)\n  • Trimmed large tool outputs\n  • Saved ~${(tokensSaved / 1000).toFixed(1)}K tokens (${tokensBefore.toLocaleString()} → ${tokensAfter.toLocaleString()})\n  • Kept last ${Math.floor(cleanedHistory.length / 2)} turn(s) for context`,
            }, Date.now());
        }
        catch (e) {
            ui.addItem({
                type: MessageType.ERROR,
                text: `Failed to cleanup context: ${e instanceof Error ? e.message : String(e)}`,
            }, Date.now());
        }
    },
};
/**
 * Estimates token count using 1 token ≈ 4 characters approximation
 */
function estimateTokens(contents) {
    const totalChars = contents.reduce((sum, content) => sum + JSON.stringify(content).length, 0);
    return Math.ceil(totalChars / 4);
}
//# sourceMappingURL=cleanupContextCommand.js.map