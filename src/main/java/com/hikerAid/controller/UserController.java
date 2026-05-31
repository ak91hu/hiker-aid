package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.model.GpxData;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api")
public class UserController {

    private static final int PACE_MIN_SAMPLES = 3;
    private static final int PACE_MAX_ACTIVITIES = 50;

    private record PaceResult(long activityCount, boolean calibrated, double paceFactor, int samples) {}
    private final Map<Long, PaceResult> paceCache = new ConcurrentHashMap<>();

    private final UserRepository userRepository;
    private final ActivityRepository activityRepository;
    private final GpxParserService gpxParser;
    private final RouteAnalysisService routeAnalysis;

    public UserController(UserRepository userRepository, ActivityRepository activityRepository,
                          GpxParserService gpxParser, RouteAnalysisService routeAnalysis) {
        this.userRepository = userRepository;
        this.activityRepository = activityRepository;
        this.gpxParser = gpxParser;
        this.routeAnalysis = routeAnalysis;
    }

    @GetMapping("/user")
    public ResponseEntity<?> currentUser(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) {
            return ResponseEntity.ok(Map.of("loggedIn", false));
        }
        String googleId = principal.getAttribute("sub");
        UserEntity user = userRepository.findByGoogleId(googleId).orElse(null);

        Map<String, Object> body = new HashMap<>();
        body.put("loggedIn", true);
        body.put("name", principal.getAttribute("name"));
        body.put("email", principal.getAttribute("email"));
        body.put("avatar", principal.getAttribute("picture"));
        body.put("admin", user != null && user.isAdmin());
        return ResponseEntity.ok(body);
    }

    @GetMapping("/user/stats")
    public ResponseEntity<?> userStats(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) return ResponseEntity.status(401).build();
        String googleId = principal.getAttribute("sub");
        UserEntity user = userRepository.findByGoogleId(googleId).orElse(null);
        if (user == null) return ResponseEntity.status(401).build();

        List<ActivityEntity> activities = activityRepository.findByUserIdOrderByRecordedAtDesc(user.getId());

        double totalKm = 0, totalGain = 0, totalCalories = 0;
        long totalMinutes = 0;
        double longestKm = 0, mostGain = 0;
        String longestName = null, mostGainName = null;

        for (ActivityEntity a : activities) {
            if (a.getDistanceKm() != null) {
                totalKm += a.getDistanceKm();
                if (a.getDistanceKm() > longestKm) { longestKm = a.getDistanceKm(); longestName = a.getName(); }
            }
            if (a.getElevationGainM() != null) {
                totalGain += a.getElevationGainM();
                if (a.getElevationGainM() > mostGain) { mostGain = a.getElevationGainM(); mostGainName = a.getName(); }
            }
            if (a.getMovingTimeMinutes() != null) totalMinutes += a.getMovingTimeMinutes();
            if (a.getCalories() != null) totalCalories += a.getCalories();
        }

        Map<String, Object> stats = new HashMap<>();
        stats.put("totalActivities", activities.size());
        stats.put("totalKm", Math.round(totalKm * 10) / 10.0);
        stats.put("totalGainM", Math.round(totalGain));
        stats.put("totalMinutes", totalMinutes);
        stats.put("totalCalories", Math.round(totalCalories));
        stats.put("longestKm", longestKm);
        stats.put("longestName", longestName);
        stats.put("mostGainM", mostGain);
        stats.put("mostGainName", mostGainName);
        return ResponseEntity.ok(stats);
    }

    @GetMapping("/user/pace")
    public ResponseEntity<?> personalPace(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) return ResponseEntity.status(401).build();
        String googleId = principal.getAttribute("sub");
        UserEntity user = userRepository.findByGoogleId(googleId).orElse(null);
        if (user == null) return ResponseEntity.status(401).build();

        long count = activityRepository.countByUserId(user.getId());
        PaceResult cached = paceCache.get(user.getId());
        PaceResult pace = (cached != null && cached.activityCount() == count)
            ? cached
            : computePace(user.getId(), count);
        paceCache.put(user.getId(), pace);

        Map<String, Object> result = new HashMap<>();
        result.put("calibrated", pace.calibrated());
        result.put("samples", pace.samples());
        if (pace.calibrated()) {
            result.put("paceFactor", Math.round(pace.paceFactor() * 100) / 100.0);
        } else {
            result.put("needed", PACE_MIN_SAMPLES);
        }
        return ResponseEntity.ok(result);
    }

    private PaceResult computePace(Long userId, long activityCount) {
        List<ActivityEntity> activities = activityRepository.findByUserIdOrderByRecordedAtDesc(userId);

        double weightedRatioSum = 0, weightSum = 0;
        int samples = 0, considered = 0;
        for (ActivityEntity a : activities) {
            if (considered >= PACE_MAX_ACTIVITIES) break;
            if (a.getGpxData() == null || a.getGpxData().isBlank()) continue;
            considered++;
            try {
                GpxData gpx = gpxParser.parse(
                    new ByteArrayInputStream(a.getGpxData().getBytes(StandardCharsets.UTF_8)));
                RouteAnalysisService.PaceCalibrationSample s = routeAnalysis.paceCalibrationSample(gpx);
                if (!s.qualifies()) continue;
                double ratio = s.baselineMovingMinutes() / s.actualMovingMinutes();
                ratio = Math.max(0.4, Math.min(2.5, ratio));
                weightedRatioSum += ratio * s.distanceKm();
                weightSum += s.distanceKm();
                samples++;
            } catch (Exception ignored) {}
        }

        if (samples < PACE_MIN_SAMPLES || weightSum <= 0) {
            return new PaceResult(activityCount, false, 0, samples);
        }
        double paceFactor = Math.max(0.5, Math.min(2.0, weightedRatioSum / weightSum));
        return new PaceResult(activityCount, true, paceFactor, samples);
    }
}
