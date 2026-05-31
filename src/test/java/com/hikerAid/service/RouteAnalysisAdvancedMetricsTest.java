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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
        assertEquals(0.0, r.stats().vamMetersPerHour(), 0.01);
    }

    @Test
    void vamScalesLinearlyWithFitness() {
        // Beginner takes longer per metre of ascent -> lower VAM.
        GpxData data = makeRoute(
            pt(47.00, 19.00, 100.0),
            pt(47.02, 19.00, 400.0)
        );
        double beginnerVam = service.analyzeWithWeight(data, 70, 170, 0,1, 8, 0).stats().vamMetersPerHour();
        double veryFitVam  = service.analyzeWithWeight(data, 70, 170, 0,5, 8, 0).stats().vamMetersPerHour();
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
        assertTrue(r.splits().isEmpty(),
            "Routes shorter than 1 km should produce no splits");
    }

    @Test
    void splitTimesScaleWithFitnessFactor() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.04, 19.00, 250.0)
        );
        long beginnerSplitMin = service.analyzeWithWeight(data, 70, 170, 0,1, 8, 0).splits().get(0).minutes();
        long veryFitSplitMin  = service.analyzeWithWeight(data, 70, 170, 0,5, 8, 0).splits().get(0).minutes();
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
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
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
        assertFalse(r.splits().isEmpty());
        double avgGrad = r.splits().get(0).avgGradientPct();
        assertTrue(avgGrad > 5 && avgGrad < 12,
            "1 km with +80 m should have ~8% avg gradient, got " + avgGrad);
    }

    // ---- Live turn-back data (cumulative time arrays) ----------------------

    @Test
    void cumulativeTimeArraysAlignWithTrackPoints() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 400.0),
            pt(47.04, 19.00, 600.0),
            pt(47.06, 19.00, 500.0)
        );
        AnalysisResult r = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0);
        SafetyAnalysis sf = r.safety();
        assertNotNull(sf.cumForwardMinutes());
        assertNotNull(sf.cumReturnMinutes());
        assertEquals(r.trackPoints().size(), sf.cumForwardMinutes().length,
            "Forward time array must align 1:1 with downsampled track points");
        assertEquals(r.trackPoints().size(), sf.cumReturnMinutes().length,
            "Return time array must align 1:1 with downsampled track points");
    }

    @Test
    void cumulativeTimeArraysStartAtZeroAndIncreaseMonotonically() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.03, 19.00, 450.0),
            pt(47.06, 19.00, 700.0)
        );
        SafetyAnalysis sf = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0).safety();
        int[] fwd = sf.cumForwardMinutes();
        int[] ret = sf.cumReturnMinutes();
        assertEquals(0, fwd[0], "Forward time at the start is zero");
        assertEquals(0, ret[0], "Return time at the start is zero");
        for (int i = 1; i < fwd.length; i++) {
            assertTrue(fwd[i] >= fwd[i - 1], "Forward time must be non-decreasing");
            assertTrue(ret[i] >= ret[i - 1], "Return time must be non-decreasing");
        }
    }

    @Test
    void forwardArrayEndMatchesPersonalizedMovingTime() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.03, 19.00, 450.0),
            pt(47.06, 19.00, 700.0)
        );
        SafetyAnalysis sf = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0).safety();
        int[] fwd = sf.cumForwardMinutes();
        assertEquals(sf.personalizedMovingMinutes(), fwd[fwd.length - 1], 1,
            "Last forward entry should equal total personalized moving time");
    }

    @Test
    void sunsetAndBufferAreExposedForLiveCountdown() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 300.0)
        );
        SafetyAnalysis sf = service.analyzeWithWeight(data, 70, 170, 0,3, 8, 0).safety();
        assertEquals(30, sf.safetyBufferMinutes());
        assertTrue(sf.sunsetMinutes() > 0 && sf.sunsetMinutes() < 24 * 60,
            "Sunset should be a valid minute-of-day, got " + sf.sunsetMinutes());
    }

    // ---- Pack load + pace calibration -------------------------------------

    @Test
    void packWeightIncreasesCaloriesAndSlowsPace() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 400.0),
            pt(47.04, 19.00, 600.0)
        );
        AnalysisResult noPack = service.analyzeWithWeight(data, 70, 170, 0, 3, 8, 0);
        AnalysisResult withPack = service.analyzeWithWeight(data, 70, 170, 20, 3, 8, 0);
        assertTrue(withPack.stats().estimatedCalories() > noPack.stats().estimatedCalories(),
            "Carrying a pack should burn more calories");
        assertTrue(withPack.stats().estimatedTimeMinutes() > noPack.stats().estimatedTimeMinutes(),
            "Carrying a pack should slow the pace");
    }

    @Test
    void explicitPaceFactorOverridesFitnessLevel() {
        GpxData data = makeRoute(
            pt(47.00, 19.00, 200.0),
            pt(47.02, 19.00, 300.0),
            pt(47.04, 19.00, 400.0)
        );
        AnalysisResult fast = service.analyzeWithPace(data, 70, 170, 0, 2.0, 8, 0);
        AnalysisResult slow = service.analyzeWithPace(data, 70, 170, 0, 0.5, 8, 0);
        assertTrue(slow.stats().estimatedTimeMinutes() > fast.stats().estimatedTimeMinutes(),
            "A lower pace factor should yield a longer time");
        assertEquals("Personalized", fast.safety().fitnessLabel());
    }

    @Test
    void paceCalibrationSampleQualifiesForTimedHike() {
        GpxData data = makeRoute(
            ptt(47.000, 19.00, 200.0, "2024-06-01T08:00:00Z"),
            ptt(47.005, 19.00, 210.0, "2024-06-01T08:08:00Z"),
            ptt(47.010, 19.00, 220.0, "2024-06-01T08:16:00Z"),
            ptt(47.015, 19.00, 230.0, "2024-06-01T08:24:00Z")
        );
        RouteAnalysisService.PaceCalibrationSample s = service.paceCalibrationSample(data);
        assertTrue(s.qualifies(), "A 1.6 km hike timed over 24 min should qualify for calibration");
        assertTrue(s.actualMovingMinutes() > 0);
        assertTrue(s.baselineMovingMinutes() > 0);
    }

    @Test
    void paceCalibrationSampleRejectsUntimedRoute() {
        GpxData data = makeRoute(
            pt(47.000, 19.00, 200.0),
            pt(47.010, 19.00, 220.0),
            pt(47.020, 19.00, 240.0)
        );
        RouteAnalysisService.PaceCalibrationSample s = service.paceCalibrationSample(data);
        assertFalse(s.qualifies(), "A route without timestamps cannot calibrate pace");
    }

    // ---- Helpers -----------------------------------------------------------

    private TrackPoint pt(double lat, double lon, double ele) {
        return new TrackPoint(lat, lon, ele, null, null);
    }

    private TrackPoint ptt(double lat, double lon, double ele, String time) {
        return new TrackPoint(lat, lon, ele, time, null);
    }

    private GpxData makeRoute(TrackPoint... points) {
        return new GpxData("Test", null, null, List.of(List.of(points)), List.of());
    }
}
