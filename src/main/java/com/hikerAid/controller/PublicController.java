package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.TrackingSessionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
public class PublicController {

    private final ActivityRepository activityRepo;
    private final TrackingSessionRepository sessionRepo;

    public PublicController(ActivityRepository activityRepo, TrackingSessionRepository sessionRepo) {
        this.activityRepo = activityRepo;
        this.sessionRepo = sessionRepo;
    }

    @GetMapping("/api/public/route/{token}")
    public ResponseEntity<?> sharedRoute(@PathVariable String token) {
        ActivityEntity a = activityRepo.findByShareToken(token).orElse(null);
        if (a == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of(
            "name", a.getName() != null ? a.getName() : "Shared route",
            "gpxData", a.getGpxData() != null ? a.getGpxData() : ""
        ));
    }

    @GetMapping("/api/public/track/{token}")
    public ResponseEntity<?> liveTrack(@PathVariable String token) {
        TrackingSessionEntity s = sessionRepo.findByToken(token).orElse(null);
        if (s == null) return ResponseEntity.notFound().build();

        Map<String, Object> m = new HashMap<>();
        m.put("active", s.isActive());
        m.put("hikerName", firstName(s.getUser().getName()));
        m.put("routeName", s.getRouteName());
        m.put("startedAt", s.getStartedAt() != null ? s.getStartedAt().toString() : null);
        m.put("lastUpdate", s.getLastUpdate() != null ? s.getLastUpdate().toString() : null);
        m.put("expectedReturn", s.getExpectedReturn() != null ? s.getExpectedReturn().toString() : null);
        m.put("hasFix", s.getLastLat() != null);
        m.put("lat", s.getLastLat());
        m.put("lon", s.getLastLon());
        m.put("accuracy", s.getLastAccuracyM());
        return ResponseEntity.ok(m);
    }

    private String firstName(String name) {
        if (name == null || name.isBlank()) return "A hiker";
        return name.trim().split("\\s+")[0];
    }
}
