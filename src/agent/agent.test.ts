import { expect, test } from 'bun:test';
import { Agent } from './agent';
import { getTools } from '../tools/registry';

test('Agent.create respects allowedToolNames filter', async () => {
  // CLI agent usually doesn't have allowedToolNames, so it gets all base tools
  const cliAgent = await Agent.create({
    model: 'gpt-4o-mini',
    memoryEnabled: false,
  });

  const apiAgent = await Agent.create({
    model: 'gpt-4o-mini',
    memoryEnabled: false,
    allowedToolNames: ['web_search', 'get_financials'],
  });

  // Base tools for gpt-4o-mini typically include read_file, browser, web_search, etc.
  const allBaseTools = getTools('gpt-4o-mini');
  const readFilePath = allBaseTools.find(t => t.name === 'read_file');
  
  if (readFilePath) {
    // Assert API agent DOES NOT have read_file
    const apiToolNames = apiAgent.getToolNames();
    expect(apiToolNames.includes('read_file')).toBe(false);
    expect(apiToolNames.includes('write_file')).toBe(false);
    
    // Assert API agent DOES have the allowed tools
    expect(apiToolNames.includes('web_search')).toBe(true);
    
    // Assert CLI agent DOES have read_file (since no allowedToolNames was provided)
    expect(cliAgent.getToolNames().includes('read_file')).toBe(true);
  } else {
    // Fallback if read_file is not registered in base tools for some reason
    const apiToolNames = apiAgent.getToolNames();
    expect(apiToolNames.every(name => ['web_search', 'get_financials'].includes(name))).toBe(true);
  }
});
