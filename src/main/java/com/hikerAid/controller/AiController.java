package com.hikerAid.controller;

import com.hikerAid.service.GeminiService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class AiController {

    private final GeminiService geminiService;

    public AiController(GeminiService geminiService) {
        this.geminiService = geminiService;
    }

    @PostMapping("/ai-analysis")
    public ResponseEntity<?> analyze(@RequestBody Map<String, Object> routeData) {
        if (!geminiService.isAvailable()) {
            return ResponseEntity.ok(Map.of("available", false));
        }

        String analysis = geminiService.analyzePerformance(routeData);
        if (analysis == null) {
            return ResponseEntity.ok(Map.of("available", false));
        }

        return ResponseEntity.ok(Map.of("available", true, "analysis", analysis));
    }
}
