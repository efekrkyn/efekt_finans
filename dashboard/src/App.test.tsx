import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';

describe('App Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)
    ) as any;
  });

  it('renders the dashboard title', () => {
    render(<App />);
    expect(screen.getByText(/Efekt/i)).toBeInTheDocument();
  });
});

