import { describe, it, expect } from 'vitest';
import { isStadtbahnDoubleFormation, isBusLineArticulated, defaultBusBlueprint } from './index';

describe('isStadtbahnDoubleFormation', () => {
  it('flags the coupled double-traction Stadtbahn lines', () => {
    for (const line of ['U1', 'U6', 'U7', 'U11', 'U12', 'U19']) {
      expect(isStadtbahnDoubleFormation(line)).toBe(true);
    }
  });

  it('treats other lines as single formation', () => {
    for (const line of ['U5', 'U14', 'U2', '']) {
      expect(isStadtbahnDoubleFormation(line)).toBe(false);
    }
    expect(isStadtbahnDoubleFormation(undefined)).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    expect(isStadtbahnDoubleFormation(' u12 ')).toBe(true);
  });
});

describe('isBusLineArticulated (city unknown, as in Live)', () => {
  it('flags listed lines and X-prefixed express lines', () => {
    expect(isBusLineArticulated(defaultBusBlueprint, '42', undefined)).toBe(true);
    expect(isBusLineArticulated(defaultBusBlueprint, 'X1', undefined)).toBe(true);
  });

  it('treats ordinary lines as rigid', () => {
    expect(isBusLineArticulated(defaultBusBlueprint, '70', undefined)).toBe(false);
    expect(isBusLineArticulated(defaultBusBlueprint, undefined, undefined)).toBe(false);
  });

  it('respects the city allow-list when a city is known', () => {
    expect(isBusLineArticulated(defaultBusBlueprint, '42', 'stuttgart')).toBe(true);
    expect(isBusLineArticulated(defaultBusBlueprint, '42', 'ulm')).toBe(false);
  });
});
