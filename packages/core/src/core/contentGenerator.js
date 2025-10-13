/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { InstallationManager } from '../utils/installationManager.js';
import { OllamaContentGenerator } from './ollamaContentGenerator.js';
import { LlamaCppContentGenerator } from './llamaCppContentGenerator.js';
export var AuthType;
(function (AuthType) {
    AuthType["LOGIN_WITH_GOOGLE"] = "oauth-personal";
    AuthType["USE_GEMINI"] = "gemini-api-key";
    AuthType["USE_VERTEX_AI"] = "vertex-ai";
    AuthType["CLOUD_SHELL"] = "cloud-shell";
    AuthType["LOCAL"] = "local";
})(AuthType || (AuthType = {}));
export function createContentGeneratorConfig(config, authType) {
    const geminiApiKey = process.env['GEMINI_API_KEY'] || undefined;
    const googleApiKey = process.env['GOOGLE_API_KEY'] || undefined;
    const googleCloudProject = process.env['GOOGLE_CLOUD_PROJECT'] || undefined;
    const googleCloudLocation = process.env['GOOGLE_CLOUD_LOCATION'] || undefined;
    const contentGeneratorConfig = {
        authType,
        proxy: config?.getProxy(),
    };
    // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
    if (authType === AuthType.LOGIN_WITH_GOOGLE ||
        authType === AuthType.CLOUD_SHELL) {
        return contentGeneratorConfig;
    }
    if (authType === AuthType.USE_GEMINI && geminiApiKey) {
        contentGeneratorConfig.apiKey = geminiApiKey;
        contentGeneratorConfig.vertexai = false;
        return contentGeneratorConfig;
    }
    if (authType === AuthType.USE_VERTEX_AI &&
        (googleApiKey || (googleCloudProject && googleCloudLocation))) {
        contentGeneratorConfig.apiKey = googleApiKey;
        contentGeneratorConfig.vertexai = true;
        return contentGeneratorConfig;
    }
    return contentGeneratorConfig;
}
export async function createContentGenerator(config, gcConfig, sessionId) {
    const version = process.env['CLI_VERSION'] || process.version;
    const userAgent = `GeminiCLI/${version} (${process.platform}; ${process.arch})`;
    const baseHeaders = {
        'User-Agent': userAgent,
    };
    if (config.authType === AuthType.LOGIN_WITH_GOOGLE ||
        config.authType === AuthType.CLOUD_SHELL) {
        const httpOptions = { headers: baseHeaders };
        return new LoggingContentGenerator(await createCodeAssistContentGenerator(httpOptions, config.authType, gcConfig, sessionId), gcConfig);
    }
    if (config.authType === AuthType.USE_GEMINI ||
        config.authType === AuthType.USE_VERTEX_AI) {
        let headers = { ...baseHeaders };
        if (gcConfig?.getUsageStatisticsEnabled()) {
            const installationManager = new InstallationManager();
            const installationId = installationManager.getInstallationId();
            headers = {
                ...headers,
                'x-gemini-api-privileged-user-id': `${installationId}`,
            };
        }
        const httpOptions = { headers };
        const googleGenAI = new GoogleGenAI({
            apiKey: config.apiKey === '' ? undefined : config.apiKey,
            vertexai: config.vertexai,
            httpOptions,
        });
        return new LoggingContentGenerator(googleGenAI.models, gcConfig);
    }
    if (config.authType === AuthType.LOCAL) {
        // Check environment variable to determine which local LLM provider to use
        const localProvider = process.env['LOCAL_LLM_PROVIDER'] || 'ollama';
        if (localProvider === 'llamacpp') {
            const llamaCppBaseUrl = process.env['LLAMACPP_BASE_URL'] || 'http://localhost:8000';
            return new LoggingContentGenerator(new LlamaCppContentGenerator(llamaCppBaseUrl, gcConfig), gcConfig);
        }
        else {
            // Default to Ollama
            const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] ||
                config.ollamaBaseUrl ||
                'http://localhost:11434';
            return new LoggingContentGenerator(new OllamaContentGenerator(ollamaBaseUrl, gcConfig), gcConfig);
        }
    }
    throw new Error(`Error creating contentGenerator: Unsupported authType: ${config.authType}`);
}
//# sourceMappingURL=contentGenerator.js.map