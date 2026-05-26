package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class UserController {

    private final UserRepository userRepository;
    private final ActivityRepository activityRepository;

    public UserController(UserRepository userRepository, ActivityRepository activityRepository) {
        this.userRepository = userRepository;
        this.activityRepository = activityRepository;
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
}
