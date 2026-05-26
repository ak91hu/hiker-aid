package com.hikerAid.repository;

import com.hikerAid.entity.ActivityEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface ActivityRepository extends JpaRepository<ActivityEntity, Long> {
    List<ActivityEntity> findByUserIdOrderByRecordedAtDesc(Long userId);
    long countByUserId(Long userId);

    @Modifying
    @Transactional
    @Query("DELETE FROM ActivityEntity a WHERE a.user.id = :userId")
    void deleteAllByUserId(Long userId);
}
