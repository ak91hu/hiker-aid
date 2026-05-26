package com.hikerAid.model;

public record ElevationPoint(
    double distanceKm,
    double elevationM,
    double gradientPct
) {}
