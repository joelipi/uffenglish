/**
 * geo-service.native.js
 * React Native geolocation provider – same as web, uses fetch.
 * Returns: { ip, country, region, city }
 */
export async function getGeoInfo() {
  try {
    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) throw new Error(`IP API responded with status ${response.status}`);
    const data = await response.json();
    console.log('[GeoService.native] Raw IP data:', data);
    return {
      ip: data.ip || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || ''
    };
  } catch (error) {
    console.warn('[GeoService.native] Failed to fetch geo data:', error);
    return { ip: '', country: '', region: '', city: '' };
  }
}
