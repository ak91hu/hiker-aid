package com.hikerAid.controller;

import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
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
}
