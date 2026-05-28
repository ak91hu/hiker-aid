package com.hikerAid.model;

public record RouteStats(
    double distanceKm,
    double elevationGainM,
    double elevationLossM,
    double maxElevationM,
    double minElevationM,
    double maxGradientPct,
    long estimatedTimeMinutes,
    long totalTimeMinutes,
    String difficulty,
    int difficultyScore,
    double estimatedCalories,
    int pointCount,
    double avgSpeedKmh,
    boolean hasElevationData,
    boolean hasTimestamps,
    double vamMetersPerHour,
    double gradeAdjustedPaceMinPerKm
) {}
