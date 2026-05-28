package com.hikerAid.model;

import java.util.List;

public record AnalysisResult(
    String name,
    String description,
    RouteStats stats,
    List<double[]> trackPoints,
    List<double[]> gradientSegments,
    List<ElevationPoint> elevationProfile,
    List<WaypointData> waypoints,
    SafetyAnalysis safety,
    List<SplitData> splits
) {}
