package com.hikerAid.repository;

import com.hikerAid.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<UserEntity, Long> {
    Optional<UserEntity> findByGoogleId(String googleId);
    Optional<UserEntity> findByEmailIgnoreCase(String email);
}
