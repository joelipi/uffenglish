/**
 * geo-service.web.js
 * Web‑specific geolocation provider using ipapi.co.
 * Returns: { ip: string, country: string, region: string, city: string }
 */
export async function getGeoInfo() {
  try {
    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) throw new Error(`IP API responded with status ${response.status}`);
    const data = await response.json();
    console.log('[GeoService.web] Raw IP data:', data);
    return {
      ip: data.ip || '',
      country: data.country || '',
      region: data.region || '',
      city: data.city || ''
    };
  } catch (error) {
    console.warn('[GeoService.web] Failed to fetch geo data:', error);
    return { ip: '', country: '', region: '', city: '' };
  }
}
