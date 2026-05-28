package com.hikerAid.service;

import com.hikerAid.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the metrics introduced in the Phase 1 analytics expansion:
 * VAM (vertical ascent metres per hour), GAP (grade-adjusted pace), and per-km splits.
 */
class RouteAnalysisAdvancedMetricsTest {

    private RouteAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new RouteAnalysisService();
    }

    // ---- VAM ---------------------------------------------------------------

    @Test
    void vamIsPositiveWhenRouteAscends() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 400.0),
            pt(47.04, 19.00, 600.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertTrue(r.stats().vamMetersPerHour() > 0,
            "VAM should be positive for a climbing route");
    }

    @Test
    void vamIsZeroOnPerfectlyFlatRoute() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.01, 19.00, 200.0),
            pt(47.02, 19.00, 200.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertEquals(0.0, r.stats().vamMetersPerHour(), 0.01);
    }

    @Test
    void vamScalesLinearlyWithFitness() {
        // Beginner takes longer per metre of ascent -> lower VAM.
        GpxData data = makeRoute(
            pt(47.00, 19.00, 100.0),
            pt(47.02, 19.00, 400.0)
        );
        double beginnerVam = service.analyzeWithWeight(data, 70, 170, 1, 8, 0).stats().vamMetersPerHour();
        double veryFitVam  = service.analyzeWithWeight(data, 70, 170, 5, 8, 0).stats().vamMetersPerHour();
        assertTrue(veryFitVam > beginnerVam,
            "Fitter hikers achieve higher VAM on the same ascent");
    }

    // ---- GAP ---------------------------------------------------------------

    @Test
    void gapIsPositiveForAnyRoute() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 100.0),
            pt(47.01, 19.00, 150.0),
            pt(47.02, 19.00, 100.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertTrue(r.stats().gradeAdjustedPaceMinPerKm() > 0);
    }

    @Test
    void gapEqualsFlatPaceWhenRouteIsFlat() {
        // For a flat route, the grade-adjustment should be a no-op and GAP ~= raw pace.
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 200.0),
            pt(47.04, 19.00, 200.0),
            pt(47.06, 19.00, 200.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        double rawPace = r.stats().estimatedTimeMinutes() / r.stats().distanceKm();
        double gap = r.stats().gradeAdjustedPaceMinPerKm();
        assertEquals(rawPace, gap, 0.5,
            "On a flat route the GAP should match the raw pace");
    }

    // ---- Splits ------------------------------------------------------------

    @Test
    void splitsHaveOneEntryPerCompleteKm() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.04, 19.00, 250.0),  // ~4.4 km
            pt(47.07, 19.00, 300.0)   // ~3.3 km -> total ~7.7 km, expect 7 full km splits
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertEquals((int) Math.floor(r.stats().distanceKm()), r.splits().size(),
            "Should emit exactly one SplitData per complete kilometre");
        for (int i = 0; i < r.splits().size(); i++) {
            assertEquals(i + 1, r.splits().get(i).km(),
                "Splits should be numbered consecutively from 1");
        }
    }

    @Test
    void splitsReturnsEmptyForRouteUnderOneKm() {
        GpxData data = makeRoute(
            pt(47.000, 19.000, 200.0),
            pt(47.001, 19.000, 210.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertTrue(r.splits().isEmpty(),
            "Routes shorter than 1 km should produce no splits");
    }

    @Test
    void splitTimesScaleWithFitnessFactor() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.04, 19.00, 250.0)
        );
        long beginnerSplitMin = service.analyzeWithWeight(data, 70, 170, 1, 8, 0).splits().get(0).minutes();
        long veryFitSplitMin  = service.analyzeWithWeight(data, 70, 170, 5, 8, 0).splits().get(0).minutes();
        assertTrue(beginnerSplitMin > veryFitSplitMin,
            "Per-km split time should reflect the fitness pace factor");
    }

    @Test
    void splitElevationDiffsBelowNoiseThresholdAreFiltered() {
        // Tiny 0.3m oscillations should not register as gain/loss in any split.
        GpxData data = makeRoute(
            pt(47.000, 19.000, 200.0),
            pt(47.005, 19.000, 200.3),
            pt(47.010, 19.000, 200.0),
            pt(47.015, 19.000, 200.3)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        for (SplitData s : r.splits()) {
            assertEquals(0.0, s.elevationGainM(), 0.01,
                "Sub-noise elevation diffs should not be counted as split gain");
            assertEquals(0.0, s.elevationLossM(), 0.01,
                "Sub-noise elevation diffs should not be counted as split loss");
        }
    }

    @Test
    void splitElevationGainsArePositiveOnClimb() {
        GpxData data = makeRoute(
            pt(47.000, 19.000, 200.0),
            pt(47.009, 19.000, 350.0)   // ~1 km with +150m climb
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertFalse(r.splits().isEmpty());
        assertTrue(r.splits().get(0).elevationGainM() > 100,
            "First split should show substantial climb");
    }

    @Test
    void splitAvgGradientReflectsTerrain() {
        GpxData data = makeRoute(
            pt(47.000, 19.000, 200.0),
            pt(47.009, 19.000, 280.0)   // ~1 km, +80 m -> ~8% avg
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 3, 8, 0);
        assertFalse(r.splits().isEmpty());
        double avgGrad = r.splits().get(0).avgGradientPct();
        assertTrue(avgGrad > 5 && avgGrad < 12,
            "1 km with +80 m should have ~8% avg gradient, got " + avgGrad);
    }

    // ---- Helpers -----------------------------------------------------------

    private TrackPoint pt(double lat, double lon, double ele) {
        return new TrackPoint(lat, lon, ele, null, null);
    }

    private GpxData makeRoute(TrackPoint... points) {
        return new GpxData("Test", null, null, List.of(List.of(points)), List.of());
    }
}
