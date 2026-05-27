package com.hikerAid.repository;

import com.hikerAid.entity.FriendInviteEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FriendInviteRepository extends JpaRepository<FriendInviteEntity, Long> {

    List<FriendInviteEntity> findByInviteeEmailIgnoreCase(String email);

    boolean existsByInviterIdAndInviteeEmailIgnoreCase(Long inviterId, String email);
}
