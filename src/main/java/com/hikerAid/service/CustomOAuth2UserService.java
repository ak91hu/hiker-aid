package com.hikerAid.service;

import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;

@Service
public class CustomOAuth2UserService extends DefaultOAuth2UserService {

    private final UserRepository userRepository;

    @Value("${ADMIN_EMAIL:}")
    private String adminEmail;

    public CustomOAuth2UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public OAuth2User loadUser(OAuth2UserRequest request) throws OAuth2AuthenticationException {
        OAuth2User oauthUser = super.loadUser(request);

        String googleId = oauthUser.getAttribute("sub");
        String email = oauthUser.getAttribute("email");
        String name = oauthUser.getAttribute("name");
        String avatar = oauthUser.getAttribute("picture");

        UserEntity user = userRepository.findByGoogleId(googleId).orElse(null);
        if (user == null) {
            user = new UserEntity(googleId, email, name, avatar);
        } else {
            user.setEmail(email);
            user.setName(name);
            user.setAvatarUrl(avatar);
        }

        if (adminEmail != null && !adminEmail.isBlank() && adminEmail.equalsIgnoreCase(email)) {
            user.setAdmin(true);
        }

        userRepository.save(user);
        return oauthUser;
    }
}
