package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the pure helpers on ActivityController used by the
 * /comparisons endpoint: GPX endpoint extraction and route-match scoring.
 * No Spring context, no database.
 */
class ActivityComparisonTest {

    private ActivityController controller;

    @BeforeEach
    void setUp() {
        // Controller pure helpers don't need the repositories
        controller = new ActivityController(null, null);
    }

    // ---- extractEndpoints --------------------------------------------------

    @Test
    void extractsStartAndEndFromMinimalGpx() {
        String gpx = """
            <?xml version="1.0"?>
            <gpx><trk><trkseg>
              <trkpt lat="47.500000" lon="19.040000"><ele>200</ele></trkpt>
              <trkpt lat="47.510000" lon="19.050000"><ele>250</ele></trkpt>
              <trkpt lat="47.520000" lon="19.060000"><ele>300</ele></trkpt>
            </trkseg></trk></gpx>
            """;
        double[] e = controller.extractEndpoints(gpx);
        assertNotNull(e);
        assertEquals(47.5, e[0], 1e-6);
        assertEquals(19.04, e[1], 1e-6);
        assertEquals(47.52, e[2], 1e-6);
        assertEquals(19.06, e[3], 1e-6);
    }

    @Test
    void extractEndpointsReturnsNullForEmptyGpx() {
        assertNull(controller.extractEndpoints(null));
        assertNull(controller.extractEndpoints(""));
        assertNull(controller.extractEndpoints("<?xml version=\"1.0\"?><gpx></gpx>"));
    }

    @Test
    void extractEndpointsHandlesAttributeOrderVariation() {
        String gpx = """
            <gpx><trk><trkseg>
              <trkpt lon="19.0" lat="47.5"/>
              <trkpt lon="19.1" lat="47.6"/>
            </trkseg></trk></gpx>
            """;
        double[] e = controller.extractEndpoints(gpx);
        // Pattern requires lat first then lon; reversed-attribute GPX is rare but real
        // and currently not extracted. This test pins the documented behaviour.
        assertNull(e, "Lon-before-lat attribute order is not supported");
    }

    @Test
    void extractEndpointsHandlesNegativeCoordinates() {
        String gpx = """
            <gpx><trk><trkseg>
              <trkpt lat="-33.8688" lon="-151.2093"><ele>10</ele></trkpt>
              <trkpt lat="-33.9000" lon="-151.2500"/>
            </trkseg></trk></gpx>
            """;
        double[] e = controller.extractEndpoints(gpx);
        assertNotNull(e);
        assertEquals(-33.8688, e[0], 1e-6);
        assertEquals(-151.2093, e[1], 1e-6);
        assertEquals(-33.9, e[2], 1e-6);
        assertEquals(-151.25, e[3], 1e-6);
    }

    @Test
    void extractEndpointsHandlesMultipleSegments() {
        String gpx = """
            <gpx><trk>
              <trkseg>
                <trkpt lat="47.5" lon="19.0"/>
                <trkpt lat="47.51" lon="19.01"/>
              </trkseg>
              <trkseg>
                <trkpt lat="47.6" lon="19.1"/>
                <trkpt lat="47.7" lon="19.2"/>
              </trkseg>
            </trk></gpx>
            """;
        double[] e = controller.extractEndpoints(gpx);
        assertNotNull(e);
        assertEquals(47.5, e[0], 1e-6, "Start should be first trkpt across all segments");
        assertEquals(47.7, e[2], 1e-6, "End should be last trkpt across all segments");
    }

    // ---- routeMatches ------------------------------------------------------

    @Test
    void identicalRoutesMatch() {
        ActivityEntity a = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        assertTrue(controller.routeMatches(a, b));
    }

    @Test
    void nearbyEndpointsWithinTwoHundredMetersMatch() {
        ActivityEntity a = activity(10.0, 500.0, 47.5,        19.0,        47.6,        19.1);
        ActivityEntity b = activity(10.0, 500.0, 47.5 + 0.001, 19.0 + 0.001, 47.6 + 0.001, 19.1 + 0.001);
        // 0.001 deg ~= 110m at lat 47.5 -> diagonal ~155m, within 200m
        assertTrue(controller.routeMatches(a, b),
            "Endpoints within 200m should still match");
    }

    @Test
    void endpointsFarApartDoNotMatch() {
        ActivityEntity a = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.0, 500.0, 48.0, 20.0, 48.1, 20.1);
        assertFalse(controller.routeMatches(a, b));
    }

    @Test
    void distanceMismatchOverTenPercentRejects() {
        ActivityEntity a = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(12.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        // 20% distance gap > 10% threshold
        assertFalse(controller.routeMatches(a, b),
            "Distance mismatch beyond 10% should reject");
    }

    @Test
    void distanceMismatchWithinTenPercentAccepts() {
        ActivityEntity a = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.5, 500.0, 47.5, 19.0, 47.6, 19.1);
        assertTrue(controller.routeMatches(a, b),
            "5% distance gap should be tolerated");
    }

    @Test
    void elevationMismatchBeyondQuarterRejects() {
        ActivityEntity a = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.0, 800.0, 47.5, 19.0, 47.6, 19.1);
        // 60% gain difference, both above the 50m floor
        assertFalse(controller.routeMatches(a, b));
    }

    @Test
    void elevationMismatchIgnoredWhenRouteIsFlat() {
        // Below the 50m floor the elevation check is skipped
        ActivityEntity a = activity(10.0, 30.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.0, 5.0,  47.5, 19.0, 47.6, 19.1);
        assertTrue(controller.routeMatches(a, b));
    }

    @Test
    void nullDistanceRejects() {
        ActivityEntity a = activity(null, 500.0, 47.5, 19.0, 47.6, 19.1);
        ActivityEntity b = activity(10.0, 500.0, 47.5, 19.0, 47.6, 19.1);
        assertFalse(controller.routeMatches(a, b));
    }

    // ---- Helpers -----------------------------------------------------------

    private ActivityEntity activity(Double distKm, Double gainM,
                                     double startLat, double startLon,
                                     double endLat,   double endLon) {
        ActivityEntity e = new ActivityEntity();
        e.setDistanceKm(distKm);
        e.setElevationGainM(gainM);
        e.setStartLat(startLat);
        e.setStartLon(startLon);
        e.setEndLat(endLat);
        e.setEndLon(endLon);
        return e;
    }
}
