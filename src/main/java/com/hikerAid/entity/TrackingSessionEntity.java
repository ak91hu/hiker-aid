package com.hikerAid.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "tracking_sessions")
public class TrackingSessionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserEntity user;

    @Column(unique = true, nullable = false)
    private String token;

    private String routeName;
    private Instant startedAt;
    private Instant lastUpdate;
    private Double lastLat;
    private Double lastLon;
    private Double lastAccuracyM;
    private Instant expectedReturn;
    private boolean active = true;
    private boolean overdueAlertSent = false;

    public TrackingSessionEntity() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public UserEntity getUser() { return user; }
    public String getToken() { return token; }
    public String getRouteName() { return routeName; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getLastUpdate() { return lastUpdate; }
    public Double getLastLat() { return lastLat; }
    public Double getLastLon() { return lastLon; }
    public Double getLastAccuracyM() { return lastAccuracyM; }
    public Instant getExpectedReturn() { return expectedReturn; }
    public boolean isActive() { return active; }
    public boolean isOverdueAlertSent() { return overdueAlertSent; }

    public void setUser(UserEntity user) { this.user = user; }
    public void setToken(String token) { this.token = token; }
    public void setRouteName(String routeName) { this.routeName = routeName; }
    public void setStartedAt(Instant v) { this.startedAt = v; }
    public void setLastUpdate(Instant v) { this.lastUpdate = v; }
    public void setLastLat(Double v) { this.lastLat = v; }
    public void setLastLon(Double v) { this.lastLon = v; }
    public void setLastAccuracyM(Double v) { this.lastAccuracyM = v; }
    public void setExpectedReturn(Instant v) { this.expectedReturn = v; }
    public void setActive(boolean v) { this.active = v; }
    public void setOverdueAlertSent(boolean v) { this.overdueAlertSent = v; }
}
