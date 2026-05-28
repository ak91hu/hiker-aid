package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/activities")
public class ActivityController {

    private final ActivityRepository activityRepo;
    private final UserRepository userRepo;

    public ActivityController(ActivityRepository activityRepo, UserRepository userRepo) {
        this.activityRepo = activityRepo;
        this.userRepo = userRepo;
    }

    @GetMapping
    public ResponseEntity<?> list(@AuthenticationPrincipal OAuth2User principal) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        List<Map<String, Object>> summaries = activityRepo
            .findByUserIdOrderByRecordedAtDesc(user.getId())
            .stream()
            .map(a -> {
                Map<String, Object> m = new HashMap<>();
                m.put("id", a.getId());
                m.put("name", a.getName() != null ? a.getName() : "Unnamed");
                m.put("recordedAt", a.getRecordedAt() != null ? a.getRecordedAt().toString() : null);
                m.put("distanceKm", a.getDistanceKm() != null ? a.getDistanceKm() : 0);
                m.put("movingTimeMinutes", a.getMovingTimeMinutes() != null ? a.getMovingTimeMinutes() : 0);
                m.put("elevationGainM", a.getElevationGainM() != null ? a.getElevationGainM() : 0);
                m.put("difficulty", a.getDifficulty() != null ? a.getDifficulty() : "Unknown");
                return m;
            })
            .toList();
        return ResponseEntity.ok(summaries);
    }

    private static final int MAX_GPX_DATA_LENGTH = 15 * 1024 * 1024;
    private static final int MAX_ACTIVITIES_PER_USER = 500;

    @PostMapping
    public ResponseEntity<?> save(@AuthenticationPrincipal OAuth2User principal,
                                   @RequestBody Map<String, Object> body) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        String gpxData = str(body.get("gpxData"));
        if (gpxData != null && gpxData.length() > MAX_GPX_DATA_LENGTH) {
            return ResponseEntity.badRequest().body(Map.of("error", "GPX data too large"));
        }

        long count = activityRepo.countByUserId(user.getId());
        if (count >= MAX_ACTIVITIES_PER_USER) {
            return ResponseEntity.badRequest().body(Map.of("error", "Activity limit reached (500)"));
        }

        ActivityEntity a = new ActivityEntity();
        a.setUser(user);
        a.setName(str(body.get("name")));
        a.setRecordedAt(LocalDateTime.now());
        a.setDistanceKm(dbl(body.get("distanceKm")));
        a.setElevationGainM(dbl(body.get("elevationGainM")));
        a.setElevationLossM(dbl(body.get("elevationLossM")));
        a.setMovingTimeMinutes(lng(body.get("movingTimeMinutes")));
        a.setTotalTimeMinutes(lng(body.get("totalTimeMinutes")));
        a.setCalories(dbl(body.get("calories")));
        a.setDifficulty(str(body.get("difficulty")));
        a.setDifficultyScore(intVal(body.get("difficultyScore")));
        a.setMaxElevationM(dbl(body.get("maxElevationM")));
        a.setMinElevationM(dbl(body.get("minElevationM")));
        a.setAvgSpeedKmh(dbl(body.get("avgSpeedKmh")));
        a.setGpxData(str(body.get("gpxData")));

        // Extract start/end coords from gpx for route comparison
        double[] coords = extractEndpoints(a.getGpxData());
        if (coords != null) {
            a.setStartLat(coords[0]); a.setStartLon(coords[1]);
            a.setEndLat(coords[2]);   a.setEndLon(coords[3]);
        }

        activityRepo.save(a);
        return ResponseEntity.ok(Map.of("id", a.getId()));
    }

    @GetMapping("/{id}/comparisons")
    public ResponseEntity<?> comparisons(@AuthenticationPrincipal OAuth2User principal,
                                          @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        ActivityEntity target = activityRepo.findById(id).orElse(null);
        if (target == null || !target.getUser().getId().equals(user.getId())) {
            return ResponseEntity.notFound().build();
        }

        // Lazy backfill if missing
        if (target.getStartLat() == null) {
            double[] c = extractEndpoints(target.getGpxData());
            if (c != null) {
                target.setStartLat(c[0]); target.setStartLon(c[1]);
                target.setEndLat(c[2]);   target.setEndLon(c[3]);
                activityRepo.save(target);
            }
        }

        if (target.getStartLat() == null || target.getDistanceKm() == null) {
            return ResponseEntity.ok(Map.of("matches", List.of(), "isPersonalBest", false));
        }

        List<ActivityEntity> all = activityRepo.findByUserIdOrderByRecordedAtDesc(user.getId());
        List<Map<String, Object>> matches = new ArrayList<>();
        List<ActivityEntity> toBackfill = new ArrayList<>();
        for (ActivityEntity other : all) {
            if (other.getId().equals(target.getId())) continue;
            if (other.getStartLat() == null) {
                double[] c = extractEndpoints(other.getGpxData());
                if (c == null) continue;
                other.setStartLat(c[0]); other.setStartLon(c[1]);
                other.setEndLat(c[2]);   other.setEndLon(c[3]);
                toBackfill.add(other);
            }
            if (!routeMatches(target, other)) continue;
            Map<String, Object> m = new HashMap<>();
            m.put("id", other.getId());
            m.put("name", other.getName());
            m.put("recordedAt", other.getRecordedAt() != null ? other.getRecordedAt().toString() : null);
            m.put("distanceKm", other.getDistanceKm());
            m.put("movingTimeMinutes", other.getMovingTimeMinutes());
            m.put("elevationGainM", other.getElevationGainM());
            matches.add(m);
        }
        if (!toBackfill.isEmpty()) activityRepo.saveAll(toBackfill);

        boolean isPersonalBest = matches.isEmpty()
            ? true
            : matches.stream().allMatch(m -> {
                Object t = m.get("movingTimeMinutes");
                if (!(t instanceof Number n) || target.getMovingTimeMinutes() == null) return true;
                return target.getMovingTimeMinutes() < n.longValue();
              });

        matches.sort(Comparator.comparing(m -> ((Number) m.getOrDefault("movingTimeMinutes", Long.MAX_VALUE)).longValue()));
        if (matches.size() > 5) matches = matches.subList(0, 5);

        long avgMin = matches.stream()
            .map(m -> m.get("movingTimeMinutes"))
            .filter(v -> v instanceof Number)
            .mapToLong(v -> ((Number) v).longValue())
            .sum();
        if (!matches.isEmpty()) avgMin /= matches.size();

        Map<String, Object> result = new HashMap<>();
        result.put("matches", matches);
        result.put("matchCount", matches.size());
        result.put("isPersonalBest", isPersonalBest && !matches.isEmpty());
        result.put("avgMinutes", matches.isEmpty() ? null : avgMin);
        result.put("currentMinutes", target.getMovingTimeMinutes());
        return ResponseEntity.ok(result);
    }

    private static final Pattern TRKPT_PATTERN = Pattern.compile(
        "<trkpt\\s+[^>]*lat=\"(-?[0-9.]+)\"[^>]*lon=\"(-?[0-9.]+)\"",
        Pattern.CASE_INSENSITIVE);

    // package-private for unit testing
    double[] extractEndpoints(String gpx) {
        if (gpx == null || gpx.isEmpty()) return null;
        Matcher m = TRKPT_PATTERN.matcher(gpx);
        double startLat = 0, startLon = 0, endLat = 0, endLon = 0;
        boolean first = true;
        while (m.find()) {
            try {
                double lat = Double.parseDouble(m.group(1));
                double lon = Double.parseDouble(m.group(2));
                if (first) { startLat = lat; startLon = lon; first = false; }
                endLat = lat; endLon = lon;
            } catch (NumberFormatException ignored) {}
        }
        if (first) return null;
        return new double[]{startLat, startLon, endLat, endLon};
    }

    // package-private for unit testing
    boolean routeMatches(ActivityEntity a, ActivityEntity b) {
        if (a.getDistanceKm() == null || b.getDistanceKm() == null) return false;
        double distRatio = Math.abs(a.getDistanceKm() - b.getDistanceKm()) / Math.max(a.getDistanceKm(), 0.1);
        if (distRatio > 0.10) return false;

        double startDist = haversineMeters(a.getStartLat(), a.getStartLon(), b.getStartLat(), b.getStartLon());
        double endDist   = haversineMeters(a.getEndLat(),   a.getEndLon(),   b.getEndLat(),   b.getEndLon());
        if (startDist > 200 || endDist > 200) return false;

        if (a.getElevationGainM() != null && b.getElevationGainM() != null
                && Math.max(a.getElevationGainM(), b.getElevationGainM()) > 50) {
            double gainRatio = Math.abs(a.getElevationGainM() - b.getElevationGainM())
                / Math.max(a.getElevationGainM(), 1.0);
            if (gainRatio > 0.25) return false;
        }
        return true;
    }

    private double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@AuthenticationPrincipal OAuth2User principal,
                                  @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        ActivityEntity a = activityRepo.findById(id).orElse(null);
        if (a == null || !a.getUser().getId().equals(user.getId())) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
            "id", a.getId(),
            "name", a.getName() != null ? a.getName() : "Unnamed",
            "gpxData", a.getGpxData() != null ? a.getGpxData() : ""
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@AuthenticationPrincipal OAuth2User principal,
                                     @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        ActivityEntity a = activityRepo.findById(id).orElse(null);
        if (a == null || !a.getUser().getId().equals(user.getId())) {
            return ResponseEntity.notFound().build();
        }
        activityRepo.delete(a);
        return ResponseEntity.ok(Map.of("deleted", true));
    }

    private UserEntity resolveUser(OAuth2User principal) {
        if (principal == null) return null;
        String googleId = principal.getAttribute("sub");
        return userRepo.findByGoogleId(googleId).orElse(null);
    }

    private String str(Object v) { return v != null ? v.toString() : null; }

    private Double dbl(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (NumberFormatException e) { return null; }
    }

    private Long lng(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString()); } catch (NumberFormatException e) { return null; }
    }

    private Integer intVal(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(v.toString()); } catch (NumberFormatException e) { return null; }
    }
}
