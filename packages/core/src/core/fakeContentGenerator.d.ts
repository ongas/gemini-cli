/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CountTokensResponse, GenerateContentResponse, GenerateContentParameters, CountTokensParameters, EmbedContentResponse, EmbedContentParameters } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId } from '../code_assist/types.js';
export type FakeResponses = {
    generateContent: GenerateContentResponse[];
    generateContentStream: GenerateContentResponse[][];
    countTokens: CountTokensResponse[];
    embedContent: EmbedContentResponse[];
};
export declare class FakeContentGenerator implements ContentGenerator {
    private responses;
    private callCounters;
    userTier?: UserTierId;
    constructor(responses: FakeResponses);
    static fromFile(filePath: string): Promise<FakeContentGenerator>;
    private getNextResponse;
    generateContent(_request: GenerateContentParameters, _userPromptId: string): Promise<GenerateContentResponse>;
    generateContentStream(_request: GenerateContentParameters, _userPromptId: string): Promise<AsyncGenerator<GenerateContentResponse>>;
    countTokens(_request: CountTokensParameters): Promise<CountTokensResponse>;
    embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse>;
}
