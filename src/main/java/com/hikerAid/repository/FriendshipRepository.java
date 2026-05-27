package com.hikerAid.repository;

import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.FriendshipEntity.Status;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FriendshipRepository extends JpaRepository<FriendshipEntity, Long> {

    @Query("SELECT f FROM FriendshipEntity f WHERE (f.requester.id = :userId OR f.addressee.id = :userId) AND f.status = :status")
    List<FriendshipEntity> findAllByUserAndStatus(Long userId, Status status);

    @Query("SELECT f FROM FriendshipEntity f WHERE f.addressee.id = :userId AND f.status = 'PENDING'")
    List<FriendshipEntity> findPendingForUser(Long userId);

    @Query("SELECT f FROM FriendshipEntity f WHERE " +
           "((f.requester.id = :userId1 AND f.addressee.id = :userId2) OR " +
           "(f.requester.id = :userId2 AND f.addressee.id = :userId1))")
    Optional<FriendshipEntity> findBetweenUsers(Long userId1, Long userId2);
}
