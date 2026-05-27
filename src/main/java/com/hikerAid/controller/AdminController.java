package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.EmailService;
import com.hikerAid.service.GeminiService;
import org.springframework.beans.factory.annotation.Value;
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
    private final GeminiService geminiService;
    private final EmailService emailService;

    @Value("${hikerAid.gemini-api-key:}")
    private String geminiKey;

    @Value("${hikerAid.admin-email:}")
    private String adminEmail;

    public AdminController(UserRepository userRepo, ActivityRepository activityRepo,
                           GeminiService geminiService, EmailService emailService) {
        this.userRepo = userRepo;
        this.activityRepo = activityRepo;
        this.geminiService = geminiService;
        this.emailService = emailService;
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

    @PostMapping("/api/admin/test-ai")
    @ResponseBody
    public ResponseEntity<?> testAi(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        Map<String, Object> result = new HashMap<>();
        result.put("configured", geminiService.isAvailable());

        if (!geminiService.isAvailable()) {
            result.put("success", false);
            result.put("error", "GEMINI_API_KEY not configured");
            return ResponseEntity.ok(result);
        }

        long start = System.currentTimeMillis();
        String response = geminiService.getHikingTip();
        long latency = System.currentTimeMillis() - start;

        result.put("success", response != null);
        result.put("latencyMs", latency);
        result.put("response", response != null ? response : "No response from Gemini");
        return ResponseEntity.ok(result);
    }

    @GetMapping("/api/admin/env-status")
    @ResponseBody
    public ResponseEntity<?> envStatus(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        Map<String, Object> env = new HashMap<>();
        env.put("GOOGLE_CLIENT_ID", !System.getenv().getOrDefault("GOOGLE_CLIENT_ID", "").isBlank());
        env.put("GOOGLE_CLIENT_SECRET", !System.getenv().getOrDefault("GOOGLE_CLIENT_SECRET", "").isBlank());
        env.put("GEMINI_API_KEY", geminiKey != null && !geminiKey.isBlank());
        env.put("ADMIN_EMAIL", adminEmail != null && !adminEmail.isBlank());
        env.put("adminEmailValue", adminEmail != null ? adminEmail : "(not set)");
        env.put("MAIL_USERNAME", emailService.isConfigured());
        env.put("TESTMAIL_API_KEY", emailService.isTestmailConfigured());
        return ResponseEntity.ok(env);
    }

    @PostMapping("/api/admin/test-email")
    @ResponseBody
    public ResponseEntity<?> testEmail(@AuthenticationPrincipal OAuth2User principal) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();

        Map<String, Object> result = new HashMap<>();
        result.put("smtpConfigured", emailService.isConfigured());
        result.put("testmailConfigured", emailService.isTestmailConfigured());

        if (!emailService.isConfigured()) {
            result.put("success", false);
            result.put("error", "SMTP not configured — set MAIL_USERNAME and MAIL_PASSWORD");
            return ResponseEntity.ok(result);
        }
        if (!emailService.isTestmailConfigured()) {
            result.put("success", false);
            result.put("error", "Testmail.app not configured — set TESTMAIL_NAMESPACE");
            return ResponseEntity.ok(result);
        }

        String tag = "hikeraid-test-" + System.currentTimeMillis();
        long start = System.currentTimeMillis();
        try {
            emailService.sendTestEmail(tag,
                    "HikerAid Email Test",
                    "This is a test email from HikerAid admin panel.\nTimestamp: " + java.time.Instant.now());
            long latency = System.currentTimeMillis() - start;
            result.put("success", true);
            result.put("tag", tag);
            result.put("latencyMs", latency);
            result.put("sentTo", tag + "." + emailService.getTestmailNamespace() + "@inbox.testmail.app");
            result.put("message", "Email sent — check inbox below");
        } catch (Exception e) {
            result.put("success", false);
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    @GetMapping("/api/admin/test-email/inbox")
    @ResponseBody
    public ResponseEntity<?> testEmailInbox(@AuthenticationPrincipal OAuth2User principal,
                                            @RequestParam(required = false) String tag) {
        if (!isAdmin(principal)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(emailService.fetchTestmailInbox(tag));
    }

    private boolean isAdmin(OAuth2User principal) {
        if (principal == null) return false;
        String googleId = principal.getAttribute("sub");
        UserEntity user = userRepo.findByGoogleId(googleId).orElse(null);
        return user != null && user.isAdmin();
    }
}
