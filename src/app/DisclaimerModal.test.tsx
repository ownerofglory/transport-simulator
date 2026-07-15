// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISCLAIMER_STORAGE_KEY, DisclaimerModal } from './DisclaimerModal';

describe('DisclaimerModal', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('shows on first launch and remembers acknowledgement', () => {
    const { unmount } = render(<DisclaimerModal />);

    expect(screen.getByRole('dialog', { name: 'Unofficial transit simulator' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I understand' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(DISCLAIMER_STORAGE_KEY)).toBe('true');

    unmount();
    render(<DisclaimerModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
