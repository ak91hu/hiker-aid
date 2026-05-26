package com.hikerAid.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
public class UserEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String googleId;

    private String email;
    private String name;
    private String avatarUrl;
    private LocalDateTime createdAt;
    private boolean admin;

    protected UserEntity() {}

    public UserEntity(String googleId, String email, String name, String avatarUrl) {
        this.googleId = googleId;
        this.email = email;
        this.name = name;
        this.avatarUrl = avatarUrl;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public String getGoogleId() { return googleId; }
    public String getEmail() { return email; }
    public String getName() { return name; }
    public String getAvatarUrl() { return avatarUrl; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public boolean isAdmin() { return admin; }

    public void setEmail(String email) { this.email = email; }
    public void setName(String name) { this.name = name; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
    public void setAdmin(boolean admin) { this.admin = admin; }
}
