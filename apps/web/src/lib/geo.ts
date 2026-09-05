'use client';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export function getCurrentPosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation.unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error('geolocation.denied')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface LocatedShop {
  id: number;
  latitude: number | null;
  longitude: number | null;
}

export function nearestShopWithinMeters(
  shops: readonly LocatedShop[],
  point: GeoPoint,
  maxMeters: number,
): number | null {
  let nearestId: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const shop of shops) {
    if (shop.latitude == null || shop.longitude == null) continue;
    const distance = distanceMeters(point, { latitude: shop.latitude, longitude: shop.longitude });
    if (distance <= maxMeters && distance < nearestDistance) {
      nearestId = shop.id;
      nearestDistance = distance;
    }
  }
  return nearestId;
}
