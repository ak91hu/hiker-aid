package com.hikerAid.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/route")
public class RoutePlannerController {

    private static final Logger log = LoggerFactory.getLogger(RoutePlannerController.class);
    private static final String BROUTER_URL = "https://brouter.de/brouter";
    private static final int MAX_POINTS = 50;

    private static final Map<String, String> PROFILES = Map.of(
        "hike", "hiking-mountain",
        "trek", "trekking",
        "walk", "walking"
    );

    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping("/plan")
    public ResponseEntity<?> plan(@RequestBody Map<String, Object> body) {
        Object raw = body.get("points");
        if (!(raw instanceof List<?> list) || list.size() < 2 || list.size() > MAX_POINTS) {
            return ResponseEntity.badRequest().body(Map.of("error", "Provide between 2 and " + MAX_POINTS + " points"));
        }

        StringBuilder lonlats = new StringBuilder();
        try {
            for (Object o : list) {
                if (!(o instanceof List<?> pair) || pair.size() < 2) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Invalid point format"));
                }
                double lat = ((Number) pair.get(0)).doubleValue();
                double lon = ((Number) pair.get(1)).doubleValue();
                if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Coordinates out of range"));
                }
                if (lonlats.length() > 0) lonlats.append("|");
                lonlats.append(lon).append(",").append(lat);
            }
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid coordinates"));
        }

        String profile = PROFILES.getOrDefault(String.valueOf(body.get("mode")), "hiking-mountain");

        URI uri = UriComponentsBuilder.fromUriString(BROUTER_URL)
            .queryParam("lonlats", lonlats.toString())
            .queryParam("profile", profile)
            .queryParam("alternativeidx", 0)
            .queryParam("format", "gpx")
            .build().encode().toUri();

        try {
            ResponseEntity<String> resp = restTemplate.getForEntity(uri, String.class);
            String gpx = resp.getBody();
            if (!resp.getStatusCode().is2xxSuccessful() || gpx == null || !gpx.trim().startsWith("<")) {
                return ResponseEntity.status(502).body(Map.of("error",
                    "No route found between those points. Move them closer to known trails or paths."));
            }
            return ResponseEntity.ok(Map.of("gpx", gpx));
        } catch (Exception e) {
            log.warn("BRouter request failed: {}", e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", "Routing service unavailable. Please try again."));
        }
    }
}
