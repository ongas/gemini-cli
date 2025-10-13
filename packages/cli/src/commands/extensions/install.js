/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installExtension, requestConsentNonInteractive, } from '../../config/extension.js';
import { getErrorMessage } from '../../utils/errors.js';
export async function handleInstall(args) {
    try {
        let installMetadata;
        if (args.source) {
            const { source } = args;
            if (source.startsWith('http://') ||
                source.startsWith('https://') ||
                source.startsWith('git@') ||
                source.startsWith('sso://')) {
                installMetadata = {
                    source,
                    type: 'git',
                    ref: args.ref,
                    autoUpdate: args.autoUpdate,
                };
            }
            else {
                throw new Error(`The source "${source}" is not a valid URL format.`);
            }
        }
        else if (args.path) {
            installMetadata = {
                source: args.path,
                type: 'local',
                autoUpdate: args.autoUpdate,
            };
        }
        else {
            // This should not be reached due to the yargs check.
            throw new Error('Either --source or --path must be provided.');
        }
        const name = await installExtension(installMetadata, requestConsentNonInteractive);
        console.log(`Extension "${name}" installed successfully and enabled.`);
    }
    catch (error) {
        console.error(getErrorMessage(error));
        process.exit(1);
    }
}
export const installCommand = {
    command: 'install [<source>] [--path] [--ref] [--auto-update]',
    describe: 'Installs an extension from a git repository URL or a local path.',
    builder: (yargs) => yargs
        .positional('source', {
        describe: 'The github URL of the extension to install.',
        type: 'string',
    })
        .option('path', {
        describe: 'Path to a local extension directory.',
        type: 'string',
    })
        .option('ref', {
        describe: 'The git ref to install from.',
        type: 'string',
    })
        .option('auto-update', {
        describe: 'Enable auto-update for this extension.',
        type: 'boolean',
    })
        .conflicts('source', 'path')
        .conflicts('path', 'ref')
        .conflicts('path', 'auto-update')
        .check((argv) => {
        if (!argv.source && !argv.path) {
            throw new Error('Either source or --path must be provided.');
        }
        return true;
    }),
    handler: async (argv) => {
        await handleInstall({
            source: argv['source'],
            path: argv['path'],
            ref: argv['ref'],
            autoUpdate: argv['auto-update'],
        });
    },
};
//# sourceMappingURL=install.js.map