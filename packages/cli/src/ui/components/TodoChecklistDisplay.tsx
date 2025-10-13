/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TodoChecklistSummary, TodoItem } from '@google/gemini-cli-core';
import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

interface TodoChecklistDisplayProps {
  checklist: TodoChecklistSummary;
}

interface TodoItemDisplayProps {
  item: TodoItem;
  level?: number;
}

const TodoItemDisplay: React.FC<TodoItemDisplayProps> = ({
  item,
  level = 0,
}) => {
  const getStatusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '⋯';
      case 'pending':
        return '○';
    }
  };

  const getStatusColor = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return theme.status.success;
      case 'in_progress':
        return theme.text.accent;
      case 'pending':
        return theme.text.secondary;
    }
  };

  const indent = '  '.repeat(level);
  const displayText =
    item.status === 'in_progress' ? item.activeForm : item.content;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor(item.status)}>
          {indent}
          {getStatusIcon(item.status)} {displayText}
        </Text>
      </Box>
      {item.subtasks &&
        item.subtasks.map((subtask) => (
          <TodoItemDisplay key={subtask.id} item={subtask} level={level + 1} />
        ))}
    </Box>
  );
};

export const TodoChecklistDisplay: React.FC<TodoChecklistDisplayProps> = ({
  checklist,
}) => {
  if (!checklist || checklist.todos.length === 0) {
    return null;
  }

  return (
    <Box paddingLeft={0} paddingY={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color={theme.text.primary} bold>
          Tasks:
        </Text>
      </Box>
      {checklist.todos.map((todo) => (
        <TodoItemDisplay key={todo.id} item={todo} />
      ))}
    </Box>
  );
};
