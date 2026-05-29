package com.hikerAid.controller;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class IconController {

    @GetMapping(value = {"/icons/icon-192.png", "/icons/icon-512.png"}, produces = "image/svg+xml")
    public ResponseEntity<Resource> icon() {
        Resource svg = new ClassPathResource("static/icons/icon.svg");
        if (!svg.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("image/svg+xml"))
                .body(svg);
    }
}
