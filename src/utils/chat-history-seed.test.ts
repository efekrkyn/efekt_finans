import { describe, test, expect } from 'bun:test';
import { pairChatMessages } from './chat-history-seed.js';

describe('pairChatMessages', () => {
  test('pairs standard back and forth', () => {
    expect(pairChatMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ])).toEqual([{ query: 'hello', answer: 'hi' }]);
  });
  
  test('handles dangling user message', () => {
    expect(pairChatMessages([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' }
    ])).toEqual([
      { query: 'q1', answer: 'a1' },
      { query: 'q2', answer: '' }
    ]);
  });
  
  test('ignores system messages', () => {
    expect(pairChatMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ])).toEqual([{ query: 'q', answer: 'a' }]);
  });
  
  test('handles multiple consecutive user messages', () => {
    expect(pairChatMessages([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' }
    ])).toEqual([
      { query: 'q1', answer: '' },
      { query: 'q2', answer: 'a2' }
    ]);
  });
});
