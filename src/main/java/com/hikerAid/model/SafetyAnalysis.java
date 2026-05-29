package com.hikerAid.model;

public record SafetyAnalysis(
    double paceFactor,
    String fitnessLabel,
    long personalizedMovingMinutes,
    long personalizedTotalMinutes,
    String sunsetEstimate,
    int availableMinutes,
    int marginMinutes,
    boolean daylightSufficient,
    double turnaroundDistanceKm,
    int turnaroundTrackIndex,
    double pointOfNoReturnKm,
    int pointOfNoReturnTrackIndex,
    int sunsetMinutes,
    int safetyBufferMinutes,
    int[] cumForwardMinutes,
    int[] cumReturnMinutes
) {}
