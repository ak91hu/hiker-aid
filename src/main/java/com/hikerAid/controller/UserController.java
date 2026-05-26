package com.hikerAid.controller;

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

    @GetMapping("/user")
    public ResponseEntity<?> currentUser(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) {
            return ResponseEntity.ok(Map.of("loggedIn", false));
        }
        Map<String, Object> body = new HashMap<>();
        body.put("loggedIn", true);
        body.put("name", principal.getAttribute("name"));
        body.put("email", principal.getAttribute("email"));
        body.put("avatar", principal.getAttribute("picture"));
        return ResponseEntity.ok(body);
    }
}
