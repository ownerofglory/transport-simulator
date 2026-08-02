// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveStationSearch } from './LiveStationSearch';

const searchStations = vi.hoisted(() => vi.fn());
vi.mock('../realtime/api', () => ({ searchStations }));

const hbf = { id: 'de:08111:6115', name: 'Stuttgart Hauptbahnhof', lat: 48.7838, lon: 9.1817 };
const rathaus = { id: 'de:08111:31', name: 'Rathaus', lat: 48.7756, lon: 9.1786 };

function type(value: string) {
  fireEvent.change(screen.getByLabelText('Find a station'), { target: { value } });
}

describe('LiveStationSearch', () => {
  afterEach(() => {
    cleanup();
    searchStations.mockReset();
  });

  it('does not spend a request on queries the backend would reject', async () => {
    render(<LiveStationSearch onPick={vi.fn()} />);
    type('H');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchStations).not.toHaveBeenCalled();
  });

  it('lists matches and hands the picked station to onPick', async () => {
    searchStations.mockResolvedValue([hbf, rathaus]);
    const onPick = vi.fn();
    render(<LiveStationSearch onPick={onPick} />);

    type('Stuttgart');
    const option = await screen.findByRole('option', { name: hbf.name });
    fireEvent.click(option);

    expect(onPick).toHaveBeenCalledWith(hbf);
    // The picked name lands in the box without re-opening the result list.
    expect(screen.queryByRole('option')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('selects with the keyboard', async () => {
    searchStations.mockResolvedValue([hbf, rathaus]);
    const onPick = vi.fn();
    render(<LiveStationSearch onPick={onPick} />);

    type('Stu');
    await screen.findByRole('option', { name: hbf.name });

    const input = screen.getByLabelText('Find a station');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith(rathaus);
  });

  it('shows a message when the lookup fails', async () => {
    searchStations.mockRejectedValue(new Error('Station search unavailable'));
    render(<LiveStationSearch onPick={vi.fn()} />);

    type('Stu');
    await waitFor(() => expect(screen.getByText('Station search unavailable')).toBeTruthy());
  });

  it('only keeps the newest query while typing', async () => {
    searchStations.mockResolvedValue([hbf]);
    render(<LiveStationSearch onPick={vi.fn()} />);

    type('Stu');
    type('Stutt');
    type('Stuttg');
    await screen.findByRole('option', { name: hbf.name });

    expect(searchStations).toHaveBeenCalledTimes(1);
    expect(searchStations.mock.calls[0][0]).toBe('Stuttg');
  });
});
