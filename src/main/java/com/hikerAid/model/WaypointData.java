package com.hikerAid.model;

public record WaypointData(
    double lat,
    double lon,
    String name,
    String description,
    String symbol,
    String type
) {}
