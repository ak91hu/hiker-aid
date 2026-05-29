package com.hikerAid.controller;

import com.hikerAid.entity.FriendInviteEntity;
import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.FriendshipEntity.Status;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendInviteRepository;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.EmailService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

@RestController
@RequestMapping("/api/friends")
public class FriendController {

    private static final Logger log = LoggerFactory.getLogger(FriendController.class);

    private final UserRepository userRepository;
    private final FriendshipRepository friendshipRepository;
    private final FriendInviteRepository friendInviteRepository;
    private final EmailService emailService;

    public FriendController(UserRepository userRepository,
                            FriendshipRepository friendshipRepository,
                            FriendInviteRepository friendInviteRepository,
                            EmailService emailService) {
        this.userRepository = userRepository;
        this.friendshipRepository = friendshipRepository;
        this.friendInviteRepository = friendInviteRepository;
        this.emailService = emailService;
    }

    @GetMapping
    public ResponseEntity<?> listFriends(@AuthenticationPrincipal OAuth2User principal) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        List<FriendshipEntity> accepted = friendshipRepository.findAllByUserAndStatus(user.getId(), Status.ACCEPTED);
        List<FriendshipEntity> pending = friendshipRepository.findPendingForUser(user.getId());

        List<Map<String, Object>> friends = new ArrayList<>();
        for (FriendshipEntity f : accepted) {
            UserEntity friend = f.getRequester().getId().equals(user.getId()) ? f.getAddressee() : f.getRequester();
            Map<String, Object> m = new HashMap<>();
            m.put("id", f.getId());
            m.put("name", friend.getName());
            m.put("email", friend.getEmail());
            m.put("avatar", friend.getAvatarUrl());
            m.put("status", "ACCEPTED");
            friends.add(m);
        }

        List<Map<String, Object>> incoming = new ArrayList<>();
        for (FriendshipEntity f : pending) {
            if (f.getAddressee().getId().equals(user.getId())) {
                Map<String, Object> m = new HashMap<>();
                m.put("id", f.getId());
                m.put("name", f.getRequester().getName());
                m.put("email", f.getRequester().getEmail());
                m.put("avatar", f.getRequester().getAvatarUrl());
                incoming.add(m);
            }
        }

        List<FriendInviteEntity> invites = friendInviteRepository.findAll().stream()
                .filter(i -> i.getInviter().getId().equals(user.getId()))
                .toList();
        List<Map<String, Object>> pendingInvites = new ArrayList<>();
        for (FriendInviteEntity inv : invites) {
            Map<String, Object> m = new HashMap<>();
            m.put("id", inv.getId());
            m.put("email", inv.getInviteeEmail());
            m.put("createdAt", inv.getCreatedAt().toString());
            pendingInvites.add(m);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("friends", friends);
        result.put("incoming", incoming);
        result.put("pendingInvites", pendingInvites);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/add")
    public ResponseEntity<?> addFriend(@AuthenticationPrincipal OAuth2User principal,
                                       @RequestBody Map<String, String> body) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        String email = body.get("email");
        if (email == null || email.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email is required"));
        }
        email = email.trim().toLowerCase();

        if (email.equalsIgnoreCase(user.getEmail())) {
            return ResponseEntity.badRequest().body(Map.of("error", "You cannot add yourself"));
        }

        Optional<UserEntity> targetOpt = userRepository.findByEmailIgnoreCase(email);

        if (targetOpt.isPresent()) {
            UserEntity target = targetOpt.get();
            Optional<FriendshipEntity> existing = friendshipRepository.findBetweenUsers(user.getId(), target.getId());
            if (existing.isPresent()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Friendship already exists"));
            }
            FriendshipEntity friendship = new FriendshipEntity(user, target, Status.PENDING);
            friendshipRepository.save(friendship);
            return ResponseEntity.ok(Map.of("status", "pending", "message", "Friend request sent to " + target.getName()));
        } else {
            if (friendInviteRepository.existsByInviterIdAndInviteeEmailIgnoreCase(user.getId(), email)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Invite already sent to this email"));
            }
            if (!emailService.isConfigured()) {
                return ResponseEntity.status(503).body(Map.of("error",
                        "Email is not configured. Ask the admin to set RESEND_API_KEY."));
            }
            FriendInviteEntity invite = new FriendInviteEntity(user, email);
            friendInviteRepository.save(invite);
            if (emailService.isConfigured()) {
                try {
                    emailService.sendFriendInvite(email, user.getName());
                    return ResponseEntity.ok(Map.of("status", "invited", "message", "Invite email sent to " + email));
                } catch (Exception e) {
                    log.warn("Invite email to {} failed (invite still saved): {}", email, e.getMessage());
                }
            }
            return ResponseEntity.ok(Map.of("status", "invited",
                    "message", "Invite saved for " + email + ". They'll be connected automatically when they sign up at hikeraid.onrender.com"));
        }
    }

    @PostMapping("/accept/{id}")
    public ResponseEntity<?> acceptFriend(@AuthenticationPrincipal OAuth2User principal,
                                          @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        FriendshipEntity friendship = friendshipRepository.findById(id).orElse(null);
        if (friendship == null) return ResponseEntity.notFound().build();

        if (!friendship.getAddressee().getId().equals(user.getId())) {
            return ResponseEntity.status(403).body(Map.of("error", "Not your request"));
        }
        if (friendship.getStatus() != Status.PENDING) {
            return ResponseEntity.badRequest().body(Map.of("error", "Already accepted"));
        }

        friendship.setStatus(Status.ACCEPTED);
        friendshipRepository.save(friendship);
        return ResponseEntity.ok(Map.of("message", "Friend request accepted"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> removeFriend(@AuthenticationPrincipal OAuth2User principal,
                                          @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        FriendshipEntity friendship = friendshipRepository.findById(id).orElse(null);
        if (friendship == null) return ResponseEntity.notFound().build();

        if (!friendship.getRequester().getId().equals(user.getId()) &&
            !friendship.getAddressee().getId().equals(user.getId())) {
            return ResponseEntity.status(403).build();
        }

        friendshipRepository.delete(friendship);
        return ResponseEntity.ok(Map.of("message", "Friend removed"));
    }

    @DeleteMapping("/invite/{id}")
    public ResponseEntity<?> cancelInvite(@AuthenticationPrincipal OAuth2User principal,
                                          @PathVariable Long id) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        FriendInviteEntity invite = friendInviteRepository.findById(id).orElse(null);
        if (invite == null) return ResponseEntity.notFound().build();

        if (!invite.getInviter().getId().equals(user.getId())) {
            return ResponseEntity.status(403).build();
        }

        friendInviteRepository.delete(invite);
        return ResponseEntity.ok(Map.of("message", "Invite cancelled"));
    }

    @PostMapping("/emergency")
    public ResponseEntity<?> sendEmergency(@AuthenticationPrincipal OAuth2User principal,
                                           @RequestBody Map<String, Object> body) {
        UserEntity user = resolveUser(principal);
        if (user == null) return ResponseEntity.status(401).build();

        Double latitude = toDouble(body.get("latitude"));
        Double longitude = toDouble(body.get("longitude"));
        double accuracy = toDouble(body.get("accuracy")) != null ? toDouble(body.get("accuracy")) : 0;
        if (latitude == null || longitude == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Coordinates are required"));
        }

        if (!emailService.isConfigured()) {
            return ResponseEntity.status(503).body(Map.of("error",
                    "Email is not configured. Emergency alerts require RESEND_API_KEY."));
        }

        List<FriendshipEntity> accepted = friendshipRepository.findAllByUserAndStatus(user.getId(), Status.ACCEPTED);
        if (accepted.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No friends to notify"));
        }

        int sent = 0;
        List<String> errors = new ArrayList<>();
        for (FriendshipEntity f : accepted) {
            UserEntity friend = f.getRequester().getId().equals(user.getId()) ? f.getAddressee() : f.getRequester();
            try {
                emailService.sendEmergencyAlert(friend.getEmail(), user.getName(), latitude, longitude, accuracy);
                sent++;
            } catch (Exception e) {
                log.error("Emergency email failed for {}: {}", friend.getEmail(), e.getMessage());
                errors.add(friend.getEmail() + ": " + e.getMessage());
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("sent", sent);
        response.put("total", accepted.size());
        if (sent == 0 && !errors.isEmpty()) {
            response.put("error", "All emails failed: " + errors.getFirst());
            return ResponseEntity.status(500).body(response);
        }
        response.put("message", sent + " of " + accepted.size() + " friends notified");
        if (!errors.isEmpty()) {
            response.put("errors", errors);
        }
        return ResponseEntity.ok(response);
    }

    private UserEntity resolveUser(OAuth2User principal) {
        if (principal == null) return null;
        String googleId = principal.getAttribute("sub");
        return userRepository.findByGoogleId(googleId).orElse(null);
    }

    private Double toDouble(Object val) {
        if (val instanceof Number n) return n.doubleValue();
        if (val instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException e) { return null; }
        }
        return null;
    }
}
