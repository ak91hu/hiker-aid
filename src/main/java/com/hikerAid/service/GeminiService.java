package com.hikerAid.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

@Service
public class GeminiService {

    private static final Logger log = LoggerFactory.getLogger(GeminiService.class);
    private static final String GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
    private static final String[] MODELS = {"gemini-2.5-flash", "gemini-2.0-flash"};

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
                "maxOutputTokens", 4096
            )
        );

        try {
            String response = callGemini(request);
            if (response != null) return response;
        } catch (Exception e) {
            return "AI analysis temporarily unavailable: " + e.getMessage();
        }
        return null;
    }

    public String getHikingTip() {
        if (!isAvailable()) return null;

        int month = java.time.LocalDate.now().getMonthValue();
        String season = month >= 3 && month <= 5 ? "spring" : month >= 6 && month <= 8 ? "summer" : month >= 9 && month <= 11 ? "autumn" : "winter";

        String prompt = "You are a mountain safety expert. Give one specific, actionable hiking tip for " + season +
            " conditions. Include WHY it matters and WHAT to do. Example quality: " +
            "'In spring, stream crossings can be dangerously swollen from snowmelt. " +
            "Carry trekking poles for stability and cross at the widest, shallowest point early in the morning before afternoon melt peaks.' " +
            "Write exactly 2-3 complete sentences. No markdown formatting, no bullet points, no bold text. Plain text only.";

        Map<String, Object> request = Map.of(
            "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))),
            "generationConfig", Map.of("temperature", 0.8, "maxOutputTokens", 2048)
        );

        try {
            String response = callGemini(request);
            if (response != null) {
                return response.replaceAll("\\*+", "").replaceAll("#+ ", "").trim();
            }
        } catch (Exception e) {
            log.warn("Hiking tip unavailable: {}", e.getMessage());
        }
        return null;
    }

    public String getModelName() {
        return MODELS[0];
    }

    public String testConnection() throws Exception {
        if (!isAvailable()) throw new IllegalStateException("GEMINI_API_KEY not configured");

        Map<String, Object> request = Map.of(
            "contents", List.of(Map.of("parts", List.of(Map.of("text", "Reply with exactly one word: OK")))),
            "generationConfig", Map.of("temperature", 0.0, "maxOutputTokens", 16)
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

        Exception lastError = null;
        for (String model : MODELS) {
            String url = GEMINI_BASE + model + ":generateContent?key=" + apiKey;
            try {
                ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);
                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    JsonNode root = objectMapper.readTree(response.getBody());
                    JsonNode error = root.path("error");
                    if (!error.isMissingNode()) {
                        lastError = new RuntimeException(model + ": " + error.path("message").asText());
                        continue;
                    }
                    JsonNode candidates = root.path("candidates");
                    if (candidates.isArray() && !candidates.isEmpty()) {
                        String text = extractText(candidates.get(0));
                        if (text != null) return model + " responded: " + text;
                    }
                    lastError = new RuntimeException(model + ": unexpected response format");
                }
            } catch (org.springframework.web.client.HttpClientErrorException e) {
                try {
                    JsonNode err = objectMapper.readTree(e.getResponseBodyAsString());
                    lastError = new RuntimeException(model + " " + e.getStatusCode() + ": " + err.path("error").path("message").asText(e.getResponseBodyAsString()));
                } catch (Exception ignored) {
                    lastError = new RuntimeException(model + " " + e.getStatusCode() + ": " + e.getResponseBodyAsString());
                }
            } catch (Exception e) {
                lastError = new RuntimeException(model + ": " + e.getMessage());
            }
        }
        throw lastError != null ? lastError : new RuntimeException("All models failed with no error detail");
    }

    private String callGemini(Map<String, Object> request) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

        for (String model : MODELS) {
            String url = GEMINI_BASE + model + ":generateContent?key=" + apiKey;
            try {
                log.info("Calling Gemini model: {}", model);
                ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    JsonNode root = objectMapper.readTree(response.getBody());

                    JsonNode error = root.path("error");
                    if (!error.isMissingNode()) {
                        log.warn("Gemini {} error: {}", model, error.path("message").asText());
                        continue;
                    }

                    JsonNode candidates = root.path("candidates");
                    if (candidates.isArray() && !candidates.isEmpty()) {
                        String text = extractText(candidates.get(0));
                        if (text != null) {
                            log.info("Got response from {}", model);
                            return text;
                        }
                    }
                }
            } catch (org.springframework.web.client.HttpClientErrorException e) {
                log.warn("Gemini {} client error {}: {}", model, e.getStatusCode(), e.getResponseBodyAsString());
                try {
                    JsonNode err = objectMapper.readTree(e.getResponseBodyAsString());
                    String msg = err.path("error").path("message").asText("");
                    if (msg.contains("API key")) throw new RuntimeException("Gemini API key error: " + msg);
                } catch (RuntimeException re) { throw re; }
                catch (Exception ignored) {}
            } catch (org.springframework.web.client.HttpServerErrorException e) {
                log.warn("Gemini {} returned {} - trying next model", model, e.getStatusCode());
            } catch (org.springframework.web.client.ResourceAccessException e) {
                log.warn("Gemini {} connection error: {} - trying next model", model, e.getMessage());
            }
        }
        log.error("All Gemini models failed");
        return null;
    }

    private String extractText(JsonNode candidate) {
        JsonNode parts = candidate.path("content").path("parts");
        if (!parts.isArray() || parts.isEmpty()) return null;

        for (int i = parts.size() - 1; i >= 0; i--) {
            JsonNode part = parts.get(i);
            if (part.has("thought") && part.path("thought").asBoolean()) continue;
            String text = part.path("text").asText("");
            if (!text.isBlank()) return text;
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
