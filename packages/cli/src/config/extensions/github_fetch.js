/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as https from 'node:https';
export function getGitHubToken() {
    return process.env['GITHUB_TOKEN'];
}
export async function fetchJson(url) {
    const headers = {
        'User-Agent': 'gemini-cli',
    };
    const token = getGitHubToken();
    if (token) {
        headers.Authorization = `token ${token}`;
    }
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers }, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Request failed with status code ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const data = Buffer.concat(chunks).toString();
                resolve(JSON.parse(data));
            });
        })
            .on('error', reject);
    });
}
//# sourceMappingURL=github_fetch.js.map