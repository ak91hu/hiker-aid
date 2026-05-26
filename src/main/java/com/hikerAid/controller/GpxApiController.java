package com.hikerAid.controller;

import com.hikerAid.model.AnalysisResult;
import com.hikerAid.model.GpxData;
import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class GpxApiController {

    private final GpxParserService gpxParser;
    private final RouteAnalysisService routeAnalysis;

    public GpxApiController(GpxParserService gpxParser, RouteAnalysisService routeAnalysis) {
        this.gpxParser = gpxParser;
        this.routeAnalysis = routeAnalysis;
    }

    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> analyze(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "weight", defaultValue = "70") double weight,
            @RequestParam(value = "fitness", defaultValue = "3") int fitness,
            @RequestParam(value = "startHour", defaultValue = "8") int startHour,
            @RequestParam(value = "startMinute", defaultValue = "0") int startMinute) {

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No file provided"));
        }
        String filename = file.getOriginalFilename();
        if (filename == null || !filename.toLowerCase().endsWith(".gpx")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Only .gpx files are supported"));
        }
        if (file.getSize() > 15 * 1024 * 1024) {
            return ResponseEntity.badRequest().body(Map.of("error", "File too large — maximum 15 MB"));
        }
        if (weight < 20 || weight > 300) {
            return ResponseEntity.badRequest().body(Map.of("error", "Weight must be between 20 and 300 kg"));
        }
        fitness = Math.max(1, Math.min(5, fitness));

        try (var is = file.getInputStream()) {
            GpxData gpxData = gpxParser.parse(is);
            AnalysisResult result = routeAnalysis.analyzeWithWeight(gpxData, weight, fitness, startHour, startMinute);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Could not parse GPX file — please check the file is valid"));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "ok", "app", "HikerAid", "version", "1.0.0"));
    }
}
