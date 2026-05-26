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
import java.util.List;
import java.util.Map;

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
            .map(a -> Map.<String, Object>of(
                "id", a.getId(),
                "name", a.getName() != null ? a.getName() : "Unnamed",
                "recordedAt", a.getRecordedAt().toString(),
                "distanceKm", a.getDistanceKm() != null ? a.getDistanceKm() : 0,
                "movingTimeMinutes", a.getMovingTimeMinutes() != null ? a.getMovingTimeMinutes() : 0,
                "elevationGainM", a.getElevationGainM() != null ? a.getElevationGainM() : 0,
                "difficulty", a.getDifficulty() != null ? a.getDifficulty() : "Unknown"
            ))
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

        activityRepo.save(a);
        return ResponseEntity.ok(Map.of("id", a.getId()));
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
