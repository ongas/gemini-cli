/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ListExtensionsCommand } from './list-extensions.js';
class CommandRegistry {
    commands = new Map();
    constructor() {
        this.register(new ListExtensionsCommand());
    }
    register(command) {
        for (const name of command.names) {
            this.commands.set(name, command);
        }
    }
    get(commandName) {
        return this.commands.get(commandName);
    }
}
export const commandRegistry = new CommandRegistry();
//# sourceMappingURL=command-registry.js.map