package com.hikerAid.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

@Service
public class GeminiService {

    private static final String GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

    @Value("${hikerAid.gemini-api-key:}")
    private String apiKey;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    public String analyzePerformance(Map<String, Object> routeData) {
        if (!isAvailable()) return null;

        String prompt = buildPrompt(routeData);

        Map<String, Object> request = Map.of(
            "contents", List.of(Map.of(
                "parts", List.of(Map.of("text", prompt))
            )),
            "generationConfig", Map.of(
                "temperature", 0.7,
                "maxOutputTokens", 800
            )
        );

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);
            String url = GEMINI_URL + "?key=" + apiKey;

            ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                JsonNode root = objectMapper.readTree(response.getBody());
                JsonNode candidates = root.path("candidates");
                if (candidates.isArray() && !candidates.isEmpty()) {
                    return candidates.get(0).path("content").path("parts").get(0).path("text").asText();
                }
            }
        } catch (Exception e) {
            return "AI analysis temporarily unavailable.";
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private String buildPrompt(Map<String, Object> data) {
        Map<String, Object> stats = (Map<String, Object>) data.get("stats");
        Map<String, Object> safety = (Map<String, Object>) data.get("safety");

        StringBuilder sb = new StringBuilder();
        sb.append("You are a professional hiking coach and mountain safety expert. ");
        sb.append("Analyze this hiking route and provide personalized performance insights.\n\n");
        sb.append("ROUTE DATA:\n");
        sb.append("- Name: ").append(data.getOrDefault("name", "Unknown")).append("\n");

        if (stats != null) {
            sb.append("- Distance: ").append(stats.getOrDefault("distanceKm", "?")).append(" km\n");
            sb.append("- Elevation gain: ").append(stats.getOrDefault("elevationGainM", "?")).append(" m\n");
            sb.append("- Elevation loss: ").append(stats.getOrDefault("elevationLossM", "?")).append(" m\n");
            sb.append("- Max elevation: ").append(stats.getOrDefault("maxElevationM", "?")).append(" m\n");
            sb.append("- Min elevation: ").append(stats.getOrDefault("minElevationM", "?")).append(" m\n");
            sb.append("- Max gradient: ").append(stats.getOrDefault("maxGradientPct", "?")).append("%\n");
            sb.append("- Moving time: ").append(stats.getOrDefault("estimatedTimeMinutes", "?")).append(" min\n");
            sb.append("- Total time (with breaks): ").append(stats.getOrDefault("totalTimeMinutes", "?")).append(" min\n");
            sb.append("- Avg speed: ").append(stats.getOrDefault("avgSpeedKmh", "?")).append(" km/h\n");
            sb.append("- Calories: ").append(stats.getOrDefault("estimatedCalories", "?")).append(" kcal\n");
            sb.append("- Difficulty: ").append(stats.getOrDefault("difficulty", "?"));
            sb.append(" (score ").append(stats.getOrDefault("difficultyScore", "?")).append("/100)\n");
        }

        if (safety != null) {
            sb.append("- Fitness level: ").append(safety.getOrDefault("fitnessLabel", "?")).append("\n");
            sb.append("- Pace factor: ").append(safety.getOrDefault("paceFactor", "?")).append("x\n");
            sb.append("- Daylight margin: ").append(safety.getOrDefault("marginMinutes", "?")).append(" min\n");
            sb.append("- Turnaround point: ").append(safety.getOrDefault("turnaroundDistanceKm", "?")).append(" km\n");
        }

        sb.append("\nProvide a concise analysis with these sections (use markdown headers):\n");
        sb.append("## Performance Summary\nRate this route's challenge relative to the hiker's fitness level. 2-3 sentences.\n\n");
        sb.append("## Key Risks\nIdentify the top 2-3 safety concerns based on the data. Be specific.\n\n");
        sb.append("## Recommendations\n3-4 actionable tips for this specific route (gear, pacing, nutrition, timing).\n\n");
        sb.append("## Training Tip\nOne specific exercise or training suggestion to prepare for this route type.\n\n");
        sb.append("Keep the total response under 250 words. Be direct, no filler.");

        return sb.toString();
    }
}
