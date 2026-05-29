import { describe, test, expect } from 'bun:test';
import { InMemoryChatHistory } from './in-memory-chat-history.js';

describe('InMemoryChatHistory', () => {
  test('seedCompletedTurns adds turns without LLM calls', () => {
    const history = new InMemoryChatHistory('dummy-model');
    
    history.seedCompletedTurns([
      { query: 'q1', answer: 'a1' },
      { query: 'q2', answer: 'a2' }
    ]);
    
    const messages = history.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].query).toBe('q1');
    expect(messages[0].answer).toBe('a1');
    expect(messages[0].summary).toBe('a1'); // Summary is directly set to answer
    
    const recent = history.getRecentTurnsAsMessages(10);
    expect(recent.length).toBe(4); // 2 turns = 4 messages (Human, AI, Human, AI)
    expect(recent[0].content).toBe('q1');
    expect(recent[1].content).toBe('a1');
  });
});
