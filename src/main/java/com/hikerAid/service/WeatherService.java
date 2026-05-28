package com.hikerAid.service;

import com.hikerAid.model.WeatherForecast;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class WeatherService {

    private static final Logger log = LoggerFactory.getLogger(WeatherService.class);
    private static final String API_URL = "https://api.open-meteo.com/v1/forecast";
    private static final long CACHE_TTL_MS = 60L * 60L * 1000L;
    private static final int MAX_HOURS = 24;
    private static final int CACHE_MAX_ENTRIES = 512;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, CacheEntry> cache = Collections.synchronizedMap(
        new LinkedHashMap<>(64, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, CacheEntry> eldest) {
                return size() > CACHE_MAX_ENTRIES;
            }
        }
    );

    public WeatherForecast getForecast(double lat, double lon) {
        String key = String.format("%.2f,%.2f", lat, lon);
        CacheEntry hit = cache.get(key);
        long now = System.currentTimeMillis();
        if (hit != null && (now - hit.timestamp) < CACHE_TTL_MS) return hit.forecast;

        String url = API_URL
            + "?latitude=" + lat
            + "&longitude=" + lon
            + "&current=temperature_2m,precipitation,wind_speed_10m,weather_code"
            + "&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code"
            + "&forecast_days=2&timezone=auto";

        try {
            ResponseEntity<String> resp = restTemplate.getForEntity(url, String.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                log.warn("Open-Meteo returned {}", resp.getStatusCode());
                return null;
            }
            JsonNode root = objectMapper.readTree(resp.getBody());

            JsonNode current = root.path("current");
            WeatherForecast.Current cur = new WeatherForecast.Current(
                current.path("temperature_2m").asDouble(),
                current.path("precipitation").asDouble(),
                current.path("wind_speed_10m").asDouble(),
                current.path("weather_code").asInt(),
                describe(current.path("weather_code").asInt())
            );

            JsonNode hourly = root.path("hourly");
            List<WeatherForecast.HourForecast> hours = new ArrayList<>();
            JsonNode times = hourly.path("time");
            JsonNode temps = hourly.path("temperature_2m");
            JsonNode precip = hourly.path("precipitation");
            JsonNode wind = hourly.path("wind_speed_10m");
            JsonNode codes = hourly.path("weather_code");

            int currentHourIdx = findCurrentHourIndex(times, current.path("time").asText(""));
            int limit = Math.min(times.size(), currentHourIdx + MAX_HOURS);
            for (int i = currentHourIdx; i < limit; i++) {
                hours.add(new WeatherForecast.HourForecast(
                    times.path(i).asText(),
                    temps.path(i).asDouble(),
                    precip.path(i).asDouble(),
                    wind.path(i).asDouble(),
                    codes.path(i).asInt(),
                    describe(codes.path(i).asInt())
                ));
            }

            WeatherForecast.WeatherRisk risk = assessRisk(cur, hours);

            WeatherForecast forecast = new WeatherForecast(
                root.path("latitude").asDouble(lat),
                root.path("longitude").asDouble(lon),
                root.path("timezone").asText("UTC"),
                cur,
                hours,
                risk
            );
            cache.put(key, new CacheEntry(forecast, now));
            return forecast;
        } catch (Exception e) {
            log.warn("Open-Meteo request failed: {}", e.getMessage());
            return null;
        }
    }

    private int findCurrentHourIndex(JsonNode times, String currentTime) {
        if (currentTime.isEmpty()) return 0;
        String prefix = currentTime.length() >= 13 ? currentTime.substring(0, 13) : currentTime;
        for (int i = 0; i < times.size(); i++) {
            if (times.path(i).asText("").startsWith(prefix)) return i;
        }
        return 0;
    }

    private WeatherForecast.WeatherRisk assessRisk(
            WeatherForecast.Current cur, List<WeatherForecast.HourForecast> hours) {
        double maxPrecip = cur.precipMm();
        double maxWind = cur.windKmh();
        double minTemp = cur.tempC();
        boolean thunderstorm = isThunderstorm(cur.weatherCode());
        boolean snow = isSnow(cur.weatherCode());

        for (WeatherForecast.HourForecast h : hours) {
            maxPrecip = Math.max(maxPrecip, h.precipMm());
            maxWind = Math.max(maxWind, h.windKmh());
            minTemp = Math.min(minTemp, h.tempC());
            if (isThunderstorm(h.weatherCode())) thunderstorm = true;
            if (isSnow(h.weatherCode())) snow = true;
        }

        StringBuilder summary = new StringBuilder();
        String level = "OK";

        if (thunderstorm) {
            level = "DANGER";
            summary.append("Thunderstorm in forecast - avoid exposed ridges. ");
        }
        if (maxWind > 40) {
            level = elevate(level, "DANGER");
            summary.append("Strong winds peak ").append(Math.round(maxWind)).append(" km/h. ");
        } else if (maxWind > 25) {
            level = elevate(level, "CAUTION");
            summary.append("Moderate winds up to ").append(Math.round(maxWind)).append(" km/h. ");
        }
        if (maxPrecip > 5) {
            level = elevate(level, "DANGER");
            summary.append("Heavy precipitation likely (").append(String.format("%.1f", maxPrecip)).append(" mm). ");
        } else if (maxPrecip > 1) {
            level = elevate(level, "CAUTION");
            summary.append("Light rain expected. ");
        }
        if (minTemp < -5) {
            level = elevate(level, "DANGER");
            summary.append("Sub-zero temps to ").append(Math.round(minTemp)).append("C - layer up. ");
        } else if (minTemp < 5) {
            level = elevate(level, "CAUTION");
            summary.append("Cold conditions, low ").append(Math.round(minTemp)).append("C. ");
        }
        if (snow && !summary.toString().contains("Snow")) {
            level = elevate(level, "CAUTION");
            summary.append("Snow forecast. ");
        }
        if (summary.length() == 0) summary.append("Conditions look favourable for hiking.");

        return new WeatherForecast.WeatherRisk(level, summary.toString().trim());
    }

    private String elevate(String current, String candidate) {
        if (current.equals("DANGER") || candidate.equals("DANGER")) return "DANGER";
        if (current.equals("CAUTION") || candidate.equals("CAUTION")) return "CAUTION";
        return "OK";
    }

    private boolean isThunderstorm(int code) { return code == 95 || code == 96 || code == 99; }
    private boolean isSnow(int code) {
        return code == 71 || code == 73 || code == 75 || code == 77 || code == 85 || code == 86;
    }

    private String describe(int code) {
        return switch (code) {
            case 0 -> "Clear sky";
            case 1, 2 -> "Mostly clear";
            case 3 -> "Overcast";
            case 45, 48 -> "Fog";
            case 51, 53, 55 -> "Drizzle";
            case 56, 57 -> "Freezing drizzle";
            case 61 -> "Light rain";
            case 63 -> "Rain";
            case 65 -> "Heavy rain";
            case 66, 67 -> "Freezing rain";
            case 71 -> "Light snow";
            case 73 -> "Snow";
            case 75 -> "Heavy snow";
            case 77 -> "Snow grains";
            case 80 -> "Light showers";
            case 81 -> "Showers";
            case 82 -> "Heavy showers";
            case 85, 86 -> "Snow showers";
            case 95 -> "Thunderstorm";
            case 96, 99 -> "Thunderstorm with hail";
            default -> "Unknown";
        };
    }

    private record CacheEntry(WeatherForecast forecast, long timestamp) {}
}
