export function pairChatMessages(messages: { role: string; content: string }[]): { query: string; answer: string }[] {
  const turns: { query: string; answer: string }[] = [];
  let currentQuery = '';
  
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      if (currentQuery) {
        turns.push({ query: currentQuery, answer: '' });
      }
      currentQuery = m.content;
    } else if (m.role === 'assistant') {
      if (currentQuery) {
        turns.push({ query: currentQuery, answer: m.content });
        currentQuery = '';
      }
    }
  }
  
  if (currentQuery) {
    turns.push({ query: currentQuery, answer: '' });
  }
  
  return turns;
}
