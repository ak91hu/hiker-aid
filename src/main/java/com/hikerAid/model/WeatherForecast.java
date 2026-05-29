package com.hikerAid.model;

import java.util.List;

public record WeatherForecast(
    double latitude,
    double longitude,
    String timezone,
    Current current,
    List<HourForecast> hourly,
    WeatherRisk risk
) {
    public record Current(
        double tempC,
        double precipMm,
        double windKmh,
        int weatherCode,
        String description
    ) {}

    public record HourForecast(
        String time,
        double tempC,
        double precipMm,
        double windKmh,
        int weatherCode,
        String description
    ) {}

    public record WeatherRisk(
        String level,
        String summary
    ) {}
}
