package com.hikerAid.config;

import javax.sql.DataSource;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

@Configuration
public class DatabaseConfig {

    private static boolean isPostgres() {
        String url = System.getenv("DATABASE_URL");
        return url != null && !url.isBlank();
    }

    @Bean
    public DataSource dataSource() {
        if (isPostgres()) {
            URI uri = URI.create(System.getenv("DATABASE_URL"));
            String[] creds = uri.getUserInfo().split(":");
            int port = uri.getPort() > 0 ? uri.getPort() : 5432;
            String jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + port + uri.getPath();

            HikariDataSource ds = new HikariDataSource();
            ds.setJdbcUrl(jdbcUrl);
            ds.setUsername(creds[0]);
            ds.setPassword(creds[1]);
            ds.setDriverClassName("org.postgresql.Driver");
            return ds;
        }

        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl("jdbc:h2:file:./data/hikeraid");
        ds.setUsername("sa");
        ds.setPassword("");
        ds.setDriverClassName("org.h2.Driver");
        return ds;
    }

    @Bean
    public HibernateJpaVendorAdapter jpaVendorAdapter() {
        HibernateJpaVendorAdapter adapter = new HibernateJpaVendorAdapter();
        if (isPostgres()) {
            adapter.setDatabasePlatform("org.hibernate.dialect.PostgreSQLDialect");
        } else {
            adapter.setDatabasePlatform("org.hibernate.dialect.H2Dialect");
        }
        return adapter;
    }
}
