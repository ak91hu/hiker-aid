package com.hikerAid.model;

import java.util.List;

public record GpxData(
    String name,
    String description,
    String creator,
    List<List<TrackPoint>> segments,
    List<WaypointData> waypoints
) {}
