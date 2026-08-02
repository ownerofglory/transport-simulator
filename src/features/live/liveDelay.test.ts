import { describe, it, expect } from 'vitest';
import { delayLevel, delayObservedFor } from './liveTypes';

describe('delayObservedFor', () => {
  it('treats the schedule model as having no delay input', () => {
    // `delaySeconds: 0` from the schedule estimator is a zero-value, not a
    // TRIAS-confirmed on-time run.
    expect(delayObservedFor('schedule')).toBe(false);
  });

  it('is false until a snapshot has reported a model', () => {
    expect(delayObservedFor(null)).toBe(false);
    expect(delayObservedFor(undefined)).toBe(false);
  });

  it('trusts any other position model', () => {
    expect(delayObservedFor('realtime')).toBe(true);
    expect(delayObservedFor('hybrid')).toBe(true);
  });
});

describe('delayLevel', () => {
  it('reports unknown while delay is unobserved, whatever the number says', () => {
    expect(delayLevel(0, false)).toBe('unknown');
    expect(delayLevel(600, false)).toBe('unknown');
  });

  it('reports unknown when the backend omits the field', () => {
    expect(delayLevel(undefined, true)).toBe('unknown');
  });

  it('grades an observed delay', () => {
    expect(delayLevel(0, true)).toBe('on-time');
    expect(delayLevel(119, true)).toBe('on-time');
    expect(delayLevel(120, true)).toBe('minor');
    expect(delayLevel(300, true)).toBe('minor');
    expect(delayLevel(301, true)).toBe('major');
  });
});
