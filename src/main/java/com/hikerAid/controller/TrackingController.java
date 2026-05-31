package com.hikerAid.controller;

import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.TrackingSessionRepository;
import com.hikerAid.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/track")
public class TrackingController {

    private final UserRepository userRepository;
    private final TrackingSessionRepository sessionRepository;

    public TrackingController(UserRepository userRepository,
                              TrackingSessionRepository sessionRepository) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
    }

    @PostMapping("/start")
    public ResponseEntity<?> start(@AuthenticationPrincipal OAuth2User principal,
                                   @RequestBody(required = false) Map<String, Object> body) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        for (TrackingSessionEntity prior : sessionRepository.findByUserIdAndActiveTrue(user.getId())) {
            prior.setActive(false);
            sessionRepository.save(prior);
        }

        TrackingSessionEntity s = new TrackingSessionEntity();
        s.setUser(user);
        s.setToken(randomToken());
        s.setStartedAt(Instant.now());
        s.setActive(true);
        if (body != null) {
            Object name = body.get("routeName");
            if (name != null) s.setRouteName(name.toString());
            s.setExpectedReturn(parseDateTime(body.get("expectedReturn")));
        }
        sessionRepository.save(s);
        return ResponseEntity.ok(Map.of("token", s.getToken(), "url", "/live/" + s.getToken()));
    }

    @PostMapping("/{token}/ping")
    public ResponseEntity<?> ping(@AuthenticationPrincipal OAuth2User principal,
                                  @PathVariable String token,
                                  @RequestBody Map<String, Object> body) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        TrackingSessionEntity s = sessionRepository.findByToken(token).orElse(null);
        if (s == null || !s.getUser().getId().equals(user.getId())) {
            return ResponseEntity.notFound().build();
        }
        if (!s.isActive()) return ResponseEntity.badRequest().body(Map.of("error", "Session ended"));

        Double lat = toDouble(body.get("latitude"));
        Double lon = toDouble(body.get("longitude"));
        if (lat == null || lon == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Coordinates required"));
        }
        s.setLastLat(lat);
        s.setLastLon(lon);
        Double acc = toDouble(body.get("accuracy"));
        s.setLastAccuracyM(acc != null ? acc : 0);
        s.setLastUpdate(Instant.now());
        sessionRepository.save(s);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/{token}/stop")
    public ResponseEntity<?> stop(@AuthenticationPrincipal OAuth2User principal,
                                  @PathVariable String token) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        TrackingSessionEntity s = sessionRepository.findByToken(token).orElse(null);
        if (s == null || !s.getUser().getId().equals(user.getId())) {
            return ResponseEntity.notFound().build();
        }
        s.setActive(false);
        sessionRepository.save(s);
        return ResponseEntity.ok(Map.of("stopped", true));
    }

    private UserEntity resolveUser(OAuth2User principal) {
        if (principal == null) return null;
        return userRepository.findByGoogleId(principal.getAttribute("sub")).orElse(null);
    }

    private Instant parseDateTime(Object val) {
        if (val == null) return null;
        try { return Instant.parse(val.toString()); }
        catch (Exception e) { return null; }
    }

    private Double toDouble(Object val) {
        if (val instanceof Number n) return n.doubleValue();
        if (val instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException e) { return null; }
        }
        return null;
    }

    private static String randomToken() {
        byte[] b = new byte[12];
        new java.security.SecureRandom().nextBytes(b);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
