package com.hikerAid.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "friend_invites")
public class FriendInviteEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inviter_id", nullable = false)
    private UserEntity inviter;

    @Column(nullable = false)
    private String inviteeEmail;

    private LocalDateTime createdAt;

    protected FriendInviteEntity() {}

    public FriendInviteEntity(UserEntity inviter, String inviteeEmail) {
        this.inviter = inviter;
        this.inviteeEmail = inviteeEmail;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public UserEntity getInviter() { return inviter; }
    public String getInviteeEmail() { return inviteeEmail; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
