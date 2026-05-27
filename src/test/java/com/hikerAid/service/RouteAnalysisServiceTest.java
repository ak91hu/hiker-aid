package com.hikerAid.service;

import com.hikerAid.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RouteAnalysisServiceTest {

    private RouteAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new RouteAnalysisService();
    }

    @Test
    void analyzesBasicRoute() {
        GpxData data = makeRoute(
            pt(47.5, 19.0, 200.0),
            pt(47.51, 19.01, 250.0),
            pt(47.52, 19.02, 300.0)
        );

        AnalysisResult result = service.analyze(data);

        assertNotNull(result);
        assertTrue(result.stats().distanceKm() > 0);
        assertTrue(result.stats().elevationGainM() > 0);
        assertTrue(result.stats().estimatedTimeMinutes() > 0);
        assertTrue(result.stats().hasElevationData());
        assertNotNull(result.safety());
    }

    @Test
    void handlesSinglePoint() {
        GpxData data = makeRoute(pt(47.5, 19.0, 200.0));

        AnalysisResult result = service.analyze(data);

        assertEquals(0, result.stats().distanceKm());
        assertEquals(0, result.stats().estimatedTimeMinutes());
        assertNull(result.safety());
    }

    @Test
    void handlesTwoPoints() {
        GpxData data = makeRoute(
            pt(47.5, 19.0, 200.0),
            pt(47.51, 19.01, 250.0)
        );

        AnalysisResult result = service.analyze(data);
        assertTrue(result.stats().distanceKm() > 0);
        assertEquals(50.0, result.stats().elevationGainM(), 5.0);
    }

    @Test
    void elevationDeadbandFiltersNoise() {
        GpxData data = makeRoute(
            pt(47.500, 19.0, 200.0),
            pt(47.501, 19.0, 201.0),  // +1m noise
            pt(47.502, 19.0, 200.5),  // -0.5m noise
            pt(47.503, 19.0, 201.5),  // +1m noise
            pt(47.504, 19.0, 200.0),  // back to start — total fluctuation < 3m deadband
            pt(47.510, 19.0, 200.0)
        );

        AnalysisResult result = service.analyze(data);
        assertEquals(0.0, result.stats().elevationGainM(), 0.1);
        assertEquals(0.0, result.stats().elevationLossM(), 0.1);
    }

    @Test
    void elevationDeadbandCountsRealClimbs() {
        GpxData data = makeRoute(
            pt(47.500, 19.0, 200.0),
            pt(47.505, 19.0, 210.0),  // +10m
            pt(47.510, 19.0, 220.0),  // +10m = 20m total, > 3m deadband
            pt(47.515, 19.0, 210.0),  // -10m
            pt(47.520, 19.0, 200.0)   // -10m = 20m descent
        );

        AnalysisResult result = service.analyze(data);
        assertEquals(20.0, result.stats().elevationGainM(), 1.0);
        assertEquals(20.0, result.stats().elevationLossM(), 1.0);
    }

    @Test
    void difficultyScoring() {
        // Short flat route = Easy
        GpxData easy = makeRoute(
            pt(47.500, 19.0, 100.0),
            pt(47.505, 19.0, 100.0)
        );
        assertEquals("Easy", service.analyze(easy).stats().difficulty());

        // Long steep route = harder
        GpxData hard = makeRoute(
            pt(47.500, 19.0, 100.0),
            pt(47.520, 19.0, 500.0),
            pt(47.540, 19.0, 900.0),
            pt(47.560, 19.0, 1300.0)
        );
        String diff = service.analyze(hard).stats().difficulty();
        assertTrue(List.of("Hard", "Very Hard", "Extreme").contains(diff));
    }

    @Test
    void calorieEstimateIncludesDescentCost() {
        GpxData upOnly = makeRoute(
            pt(47.500, 19.0, 100.0),
            pt(47.510, 19.0, 200.0)
        );

        GpxData upAndDown = makeRoute(
            pt(47.500, 19.0, 100.0),
            pt(47.510, 19.0, 200.0),
            pt(47.520, 19.0, 100.0)
        );

        double calUp = service.analyze(upOnly).stats().estimatedCalories();
        double calUpDown = service.analyze(upAndDown).stats().estimatedCalories();
        assertTrue(calUpDown > calUp);
    }

    @Test
    void fitnessPaceAffectsTime() {
        GpxData data = makeRoute(
            pt(47.500, 19.0, 200.0),
            pt(47.510, 19.0, 300.0),
            pt(47.520, 19.0, 400.0),
            pt(47.530, 19.0, 500.0)
        );

        AnalysisResult beginner = service.analyzeWithWeight(data, 70, 170, 1, 8, 0);
        AnalysisResult average = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        AnalysisResult veryFit = service.analyzeWithWeight(data, 70, 170, 5, 8, 0);

        assertTrue(beginner.stats().estimatedTimeMinutes() > average.stats().estimatedTimeMinutes());
        assertTrue(average.stats().estimatedTimeMinutes() > veryFit.stats().estimatedTimeMinutes());
    }

    @Test
    void safetyAnalysisPresent() {
        GpxData data = makeRoute(
            pt(47.500, 19.0, 200.0),
            pt(47.510, 19.0, 300.0),
            pt(47.520, 19.0, 400.0)
        );

        AnalysisResult result = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        SafetyAnalysis safety = result.safety();

        assertNotNull(safety);
        assertEquals(1.0, safety.paceFactor());
        assertEquals("Average", safety.fitnessLabel());
        assertNotNull(safety.sunsetEstimate());
        assertTrue(safety.turnaroundDistanceKm() >= 0);
        assertTrue(safety.pointOfNoReturnKm() >= 0);
    }

    @Test
    void restBreaksAddedForLongHikes() {
        GpxData data = makeRoute(
            pt(47.0, 19.0, 100.0),
            pt(47.1, 19.0, 200.0),
            pt(47.2, 19.0, 300.0),
            pt(47.3, 19.0, 400.0),
            pt(47.4, 19.0, 500.0)
        );

        AnalysisResult result = service.analyze(data);
        long moving = result.stats().estimatedTimeMinutes();
        long total = result.stats().totalTimeMinutes();

        if (moving > 60) {
            assertTrue(total > moving, "Total time should include rest breaks for hikes > 1h");
        }
    }

    @Test
    void trackPointsSubsampled() {
        TrackPoint[] pts = new TrackPoint[100];
        for (int i = 0; i < 100; i++) {
            pts[i] = pt(47.5 + i * 0.001, 19.0, 200.0 + i);
        }
        GpxData data = makeRoute(pts);

        AnalysisResult result = service.analyze(data);
        assertTrue(result.trackPoints().size() <= 100);
        assertTrue(result.trackPoints().size() >= 2);
    }

    @Test
    void gradientSegmentsContiguous() {
        TrackPoint[] pts = new TrackPoint[50];
        for (int i = 0; i < 50; i++) {
            pts[i] = pt(47.5 + i * 0.001, 19.0, 200.0 + i * 5);
        }
        GpxData data = makeRoute(pts);

        AnalysisResult result = service.analyze(data);
        List<double[]> segs = result.gradientSegments();

        for (int i = 1; i < segs.size(); i++) {
            double prevEndLat = segs.get(i - 1)[2];
            double prevEndLon = segs.get(i - 1)[3];
            double currStartLat = segs.get(i)[0];
            double currStartLon = segs.get(i)[1];
            assertEquals(prevEndLat, currStartLat, 0.0001, "Segment " + i + " not contiguous (lat)");
            assertEquals(prevEndLon, currStartLon, 0.0001, "Segment " + i + " not contiguous (lon)");
        }
    }

    @Test
    void noElevationDataHandled() {
        GpxData data = makeRoute(
            new TrackPoint(47.5, 19.0, null, null, null),
            new TrackPoint(47.51, 19.01, null, null, null)
        );

        AnalysisResult result = service.analyze(data);
        assertFalse(result.stats().hasElevationData());
        assertTrue(result.elevationProfile().isEmpty());
        assertEquals(0.0, result.stats().elevationGainM());
    }

    private TrackPoint pt(double lat, double lon, double ele) {
        return new TrackPoint(lat, lon, ele, null, null);
    }

    private GpxData makeRoute(TrackPoint... points) {
        return new GpxData("Test", null, null, List.of(List.of(points)), List.of());
    }
}
