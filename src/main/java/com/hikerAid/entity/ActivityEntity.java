package com.hikerAid.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "activities")
public class ActivityEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserEntity user;

    private String name;
    private LocalDateTime recordedAt;
    private Double distanceKm;
    private Double elevationGainM;
    private Double elevationLossM;
    private Long movingTimeMinutes;
    private Long totalTimeMinutes;
    private Double calories;
    private String difficulty;
    private Integer difficultyScore;
    private Double maxElevationM;
    private Double minElevationM;
    private Double avgSpeedKmh;
    private Double startLat;
    private Double startLon;
    private Double endLat;
    private Double endLon;

    @Lob
    private String gpxData;

    public ActivityEntity() {}

    public Long getId() { return id; }
    public UserEntity getUser() { return user; }
    public String getName() { return name; }
    public LocalDateTime getRecordedAt() { return recordedAt; }
    public Double getDistanceKm() { return distanceKm; }
    public Double getElevationGainM() { return elevationGainM; }
    public Double getElevationLossM() { return elevationLossM; }
    public Long getMovingTimeMinutes() { return movingTimeMinutes; }
    public Long getTotalTimeMinutes() { return totalTimeMinutes; }
    public Double getCalories() { return calories; }
    public String getDifficulty() { return difficulty; }
    public Integer getDifficultyScore() { return difficultyScore; }
    public Double getMaxElevationM() { return maxElevationM; }
    public Double getMinElevationM() { return minElevationM; }
    public Double getAvgSpeedKmh() { return avgSpeedKmh; }
    public Double getStartLat() { return startLat; }
    public Double getStartLon() { return startLon; }
    public Double getEndLat() { return endLat; }
    public Double getEndLon() { return endLon; }
    public String getGpxData() { return gpxData; }

    public void setUser(UserEntity user) { this.user = user; }
    public void setName(String name) { this.name = name; }
    public void setRecordedAt(LocalDateTime recordedAt) { this.recordedAt = recordedAt; }
    public void setDistanceKm(Double v) { this.distanceKm = v; }
    public void setElevationGainM(Double v) { this.elevationGainM = v; }
    public void setElevationLossM(Double v) { this.elevationLossM = v; }
    public void setMovingTimeMinutes(Long v) { this.movingTimeMinutes = v; }
    public void setTotalTimeMinutes(Long v) { this.totalTimeMinutes = v; }
    public void setCalories(Double v) { this.calories = v; }
    public void setDifficulty(String v) { this.difficulty = v; }
    public void setDifficultyScore(Integer v) { this.difficultyScore = v; }
    public void setMaxElevationM(Double v) { this.maxElevationM = v; }
    public void setMinElevationM(Double v) { this.minElevationM = v; }
    public void setAvgSpeedKmh(Double v) { this.avgSpeedKmh = v; }
    public void setStartLat(Double v) { this.startLat = v; }
    public void setStartLon(Double v) { this.startLon = v; }
    public void setEndLat(Double v) { this.endLat = v; }
    public void setEndLon(Double v) { this.endLon = v; }
    public void setGpxData(String gpxData) { this.gpxData = gpxData; }
}
