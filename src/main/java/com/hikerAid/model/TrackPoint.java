package com.hikerAid.model;

public record TrackPoint(
    double lat,
    double lon,
    Double elevation,
    String time,
    Integer heartRate,
    Integer cadence
) {}
