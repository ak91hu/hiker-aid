package com.hikerAid.controller;

import com.hikerAid.model.WeatherForecast;
import com.hikerAid.service.WeatherService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/weather")
public class WeatherController {

    private final WeatherService weatherService;

    public WeatherController(WeatherService weatherService) {
        this.weatherService = weatherService;
    }

    @GetMapping
    public ResponseEntity<?> getForecast(
            @RequestParam double lat,
            @RequestParam double lon) {

        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid coordinates"));
        }

        WeatherForecast forecast = weatherService.getForecast(lat, lon);
        if (forecast == null) {
            return ResponseEntity.status(503).body(Map.of("error", "Weather service unavailable"));
        }
        return ResponseEntity.ok(forecast);
    }
}
