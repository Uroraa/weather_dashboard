const LAT_ORIGIN = 20.9076452751;
const LNG_ORIGIN = 105.8533152221;
const LAT_PER_M  = 0.0000089831;
const LNG_PER_M  = 0.0000096163;

function xyToLatLng(x, y) {
    return {
        lat: LAT_ORIGIN + y * LAT_PER_M,
        lng: LNG_ORIGIN + x * LNG_PER_M,
    };
}

function latLngToXY(lat, lng) {
    const x = Math.round(((lng - LNG_ORIGIN) / LNG_PER_M) * 2) / 2;
    const y = Math.round(((lat - LAT_ORIGIN) / LAT_PER_M) * 2) / 2;
    return { x, y };
}

module.exports = { xyToLatLng, latLngToXY };
