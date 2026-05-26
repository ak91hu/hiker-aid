package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import java.lang.management.ManagementFactory;
import java.util.*;

@Controller
public class AdminController {

    private final UserRepository userRepo;
    private final ActivityRepository activityRepo;

    public AdminController(UserRepository userRepo, ActivityRepository activityRepo) {
        this.userRepo = userRepo;
        this.activityRepo = activityRepo;
    }

    @GetMapping("/admin")
    public String adminPage(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return "redirect:/";
        return "admin";
    }

    @GetMapping("/api/admin/stats")
    @ResponseBody
    public ResponseEntity<?> stats(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        long totalUsers = userRepo.count();
        long totalActivities = activityRepo.count();

        Runtime rt = Runtime.getRuntime();
        long uptimeMs = ManagementFactory.getRuntimeMXBean().getUptime();
        long usedMb = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024);
        long maxMb = rt.maxMemory() / (1024 * 1024);

        long uptimeSec = uptimeMs / 1000;
        String uptime = String.format("%dd %dh %dm", uptimeSec / 86400, (uptimeSec % 86400) / 3600, (uptimeSec % 3600) / 60);

        return ResponseEntity.ok(Map.of(
            "totalUsers", totalUsers,
            "totalActivities", totalActivities,
            "memoryUsedMb", usedMb,
            "memoryMaxMb", maxMb,
            "uptime", uptime,
            "javaVersion", System.getProperty("java.version")
        ));
    }

    @GetMapping("/api/admin/users")
    @ResponseBody
    public ResponseEntity<?> users(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        List<Map<String, Object>> list = userRepo.findAll().stream().map(u -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", u.getId());
            m.put("name", u.getName());
            m.put("email", u.getEmail());
            m.put("avatarUrl", u.getAvatarUrl());
            m.put("admin", u.isAdmin());
            m.put("createdAt", u.getCreatedAt() != null ? u.getCreatedAt().toString() : null);
            m.put("activityCount", activityRepo.countByUserId(u.getId()));
            return m;
        }).toList();

        return ResponseEntity.ok(list);
    }

    @GetMapping("/api/admin/activities")
    @ResponseBody
    public ResponseEntity<?> activities(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        List<Map<String, Object>> list = activityRepo.findAll().stream()
            .sorted(Comparator.comparing(ActivityEntity::getRecordedAt, Comparator.nullsLast(Comparator.reverseOrder())))
            .limit(100)
            .map(a -> {
                Map<String, Object> m = new HashMap<>();
                m.put("id", a.getId());
                m.put("name", a.getName());
                m.put("userName", a.getUser().getName());
                m.put("userEmail", a.getUser().getEmail());
                m.put("recordedAt", a.getRecordedAt() != null ? a.getRecordedAt().toString() : null);
                m.put("distanceKm", a.getDistanceKm());
                m.put("difficulty", a.getDifficulty());
                m.put("movingTimeMinutes", a.getMovingTimeMinutes());
                return m;
            }).toList();

        return ResponseEntity.ok(list);
    }

    @DeleteMapping("/api/admin/users/{id}")
    @ResponseBody
    public ResponseEntity<?> deleteUser(@AuthenticationPrincipal OAuth2User principal, @PathVariable Long id) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        UserEntity user = userRepo.findById(id).orElse(null);
        if (user == null) return ResponseEntity.notFound().build();
        if (user.isAdmin()) return ResponseEntity.badRequest().body(Map.of("error", "Cannot delete admin user"));

        activityRepo.deleteAllByUserId(user.getId());
        userRepo.delete(user);
        return ResponseEntity.ok(Map.of("deleted", true));
    }

    @DeleteMapping("/api/admin/activities/{id}")
    @ResponseBody
    public ResponseEntity<?> deleteActivity(@AuthenticationPrincipal OAuth2User principal, @PathVariable Long id) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        ActivityEntity a = activityRepo.findById(id).orElse(null);
        if (a == null) return ResponseEntity.notFound().build();
        activityRepo.delete(a);
        return ResponseEntity.ok(Map.of("deleted", true));
    }

    private boolean isAdmin(OAuth2User principal) {
        if (principal == null) return false;
        String googleId = principal.getAttribute("sub");
        UserEntity user = userRepo.findByGoogleId(googleId).orElse(null);
        return user != null && user.isAdmin();
    }
}
