package com.hikerAid.model;

public record SplitData(
    int km,
    long minutes,
    double elevationGainM,
    double elevationLossM,
    double avgGradientPct
) {}
