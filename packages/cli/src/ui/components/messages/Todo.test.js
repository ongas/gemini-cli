import { jsx as _jsx } from "react/jsx-runtime";
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import { TodoTray } from './Todo.js';
import { UIStateContext } from '../../contexts/UIStateContext.js';
import { ToolCallStatus } from '../../types.js';
const createTodoHistoryItem = (todos) => ({
    type: 'tool_group',
    id: '1',
    tools: [
        {
            name: 'write_todos_list',
            callId: 'tool-1',
            status: ToolCallStatus.Success,
            resultDisplay: {
                todos,
            },
        },
    ],
});
describe('<TodoTray />', () => {
    const renderWithUiState = (uiState) => render(_jsx(UIStateContext.Provider, { value: uiState, children: _jsx(TodoTray, {}) }));
    it.each([true, false])('renders null when no todos are in the history', (showFullTodos) => {
        const { lastFrame } = renderWithUiState({ history: [], showFullTodos });
        expect(lastFrame()).toMatchSnapshot();
    });
    it.each([true, false])('renders null when todo list is empty', (showFullTodos) => {
        const { lastFrame } = renderWithUiState({
            history: [createTodoHistoryItem([])],
            showFullTodos,
        });
        expect(lastFrame()).toMatchSnapshot();
    });
    it.each([true, false])('renders when todos exist but none are in progress', (showFullTodos) => {
        const { lastFrame } = renderWithUiState({
            history: [
                createTodoHistoryItem([
                    { description: 'Pending Task', status: 'pending' },
                    { description: 'In Progress Task', status: 'cancelled' },
                    { description: 'Completed Task', status: 'completed' },
                ]),
            ],
            showFullTodos,
        });
        expect(lastFrame()).toMatchSnapshot();
    });
    it.each([true, false])('renders when todos exist and one is in progress', (showFullTodos) => {
        const { lastFrame } = renderWithUiState({
            history: [
                createTodoHistoryItem([
                    { description: 'Pending Task', status: 'pending' },
                    { description: 'Task 2', status: 'in_progress' },
                    { description: 'In Progress Task', status: 'cancelled' },
                    { description: 'Completed Task', status: 'completed' },
                ]),
            ],
            showFullTodos,
        });
        expect(lastFrame()).toMatchSnapshot();
    });
    it.each([true, false])('renders a todo list with long descriptions that wrap when full view is on', (showFullTodos) => {
        const { lastFrame } = render(_jsx(Box, { width: "50", children: _jsx(UIStateContext.Provider, { value: {
                    history: [
                        createTodoHistoryItem([
                            {
                                description: 'This is a very long description for a pending task that should wrap around multiple lines when the terminal width is constrained.',
                                status: 'in_progress',
                            },
                            {
                                description: 'Another completed task with an equally verbose description to test wrapping behavior.',
                                status: 'completed',
                            },
                        ]),
                    ],
                    showFullTodos,
                }, children: _jsx(TodoTray, {}) }) }));
        expect(lastFrame()).toMatchSnapshot();
    });
    it('renders the most recent todo list when multiple write_todos calls are in history', () => {
        const { lastFrame } = renderWithUiState({
            history: [
                createTodoHistoryItem([
                    { description: 'Older Task 1', status: 'completed' },
                    { description: 'Older Task 2', status: 'pending' },
                ]),
                createTodoHistoryItem([
                    { description: 'Newer Task 1', status: 'pending' },
                    { description: 'Newer Task 2', status: 'in_progress' },
                ]),
            ],
            showFullTodos: true,
        });
        expect(lastFrame()).toMatchSnapshot();
    });
});
//# sourceMappingURL=Todo.test.js.map