import { describe, expect, it } from 'vitest';
import { nearestShopWithinMeters } from '../src/lib/geo';

describe('nearestShopWithinMeters', () => {
  const point = { latitude: 0, longitude: 0 };

  it('returns the nearest shop within the threshold', () => {
    const shops = [
      { id: 2, latitude: 0.0009, longitude: 0 },
      { id: 1, latitude: 0.0004, longitude: 0 },
    ];
    expect(nearestShopWithinMeters(shops, point, 50)).toBe(1);
  });

  it('returns null when no shop is within the threshold', () => {
    const shops = [{ id: 2, latitude: 0.0009, longitude: 0 }];
    expect(nearestShopWithinMeters(shops, point, 50)).toBeNull();
  });

  it('ignores shops without coordinates', () => {
    const shops = [
      { id: 9, latitude: null, longitude: null },
      { id: 2, latitude: 0.0009, longitude: 0 },
    ];
    expect(nearestShopWithinMeters(shops, point, 50)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nearestShopWithinMeters([], point, 50)).toBeNull();
  });
});
