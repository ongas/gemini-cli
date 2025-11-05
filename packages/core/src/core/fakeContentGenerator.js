/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { promises } from 'node:fs';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
// A ContentGenerator that responds with canned responses.
//
// Typically these would come from a file, provided by the `--fake-responses`
// CLI argument.
export class FakeContentGenerator {
    responses;
    callCounters = {
        generateContent: 0,
        generateContentStream: 0,
        countTokens: 0,
        embedContent: 0,
    };
    userTier;
    constructor(responses) {
        this.responses = {
            generateContent: responses.generateContent ?? [],
            generateContentStream: responses.generateContentStream ?? [],
            countTokens: responses.countTokens ?? [],
            embedContent: responses.embedContent ?? [],
        };
    }
    static async fromFile(filePath) {
        const fileContent = await promises.readFile(filePath, 'utf-8');
        const responses = JSON.parse(fileContent);
        return new FakeContentGenerator(responses);
    }
    getNextResponse(method, request) {
        const response = this.responses[method][this.callCounters[method]++];
        if (!response) {
            throw new Error(`No more mock responses for ${method}, got request:\n` +
                safeJsonStringify(request));
        }
        return response;
    }
    async generateContent(_request, _userPromptId) {
        return this.getNextResponse('generateContent', _request);
    }
    async generateContentStream(_request, _userPromptId) {
        const responses = this.getNextResponse('generateContentStream', _request);
        async function* stream() {
            for (const response of responses) {
                yield response;
            }
        }
        return stream();
    }
    async countTokens(_request) {
        return this.getNextResponse('countTokens', _request);
    }
    async embedContent(_request) {
        return this.getNextResponse('embedContent', _request);
    }
}
//# sourceMappingURL=fakeContentGenerator.js.map