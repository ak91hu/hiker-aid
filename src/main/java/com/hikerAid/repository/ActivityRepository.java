package com.hikerAid.repository;

import com.hikerAid.entity.ActivityEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ActivityRepository extends JpaRepository<ActivityEntity, Long> {
    List<ActivityEntity> findByUserIdOrderByRecordedAtDesc(Long userId);
    long countByUserId(Long userId);
}
