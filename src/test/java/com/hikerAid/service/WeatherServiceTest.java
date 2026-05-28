package com.hikerAid.service;

import com.hikerAid.model.WeatherForecast;
import com.hikerAid.model.WeatherForecast.Current;
import com.hikerAid.model.WeatherForecast.HourForecast;
import com.hikerAid.model.WeatherForecast.WeatherRisk;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the pure functions in WeatherService: WMO code lookup and
 * risk-level heuristics. No HTTP traffic.
 */
class WeatherServiceTest {

    private WeatherService service;

    @BeforeEach
    void setUp() {
        service = new WeatherService();
    }

    // ---- describe ----------------------------------------------------------

    @Test
    void describesKnownWmoCodes() {
        assertEquals("Clear sky", service.describe(0));
        assertEquals("Overcast", service.describe(3));
        assertEquals("Fog", service.describe(45));
        assertEquals("Rain", service.describe(63));
        assertEquals("Heavy rain", service.describe(65));
        assertEquals("Snow", service.describe(73));
        assertEquals("Thunderstorm", service.describe(95));
        assertEquals("Thunderstorm with hail", service.describe(99));
    }

    @Test
    void unknownWmoCodeReturnsUnknown() {
        assertEquals("Unknown", service.describe(999));
        assertEquals("Unknown", service.describe(-1));
    }

    // ---- assessRisk --------------------------------------------------------

    @Test
    void calmConditionsAreOk() {
        Current cur = currentAt(15.0, 0.0, 5.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of(
            hourAt("2026-05-29T10:00", 16.0, 0.0, 6.0, 1),
            hourAt("2026-05-29T11:00", 17.0, 0.0, 7.0, 1)
        ));
        assertEquals("OK", risk.level());
        assertNotNull(risk.summary());
    }

    @Test
    void thunderstormIsDanger() {
        Current cur = currentAt(20.0, 0.0, 10.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of(
            hourAt("2026-05-29T15:00", 18.0, 0.0, 12.0, 95)
        ));
        assertEquals("DANGER", risk.level());
        assertTrue(risk.summary().toLowerCase().contains("thunderstorm"));
    }

    @Test
    void hailThunderstormIsDanger() {
        Current cur = currentAt(20.0, 0.0, 10.0, 99);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("DANGER", risk.level());
    }

    @Test
    void strongWindIsDanger() {
        Current cur = currentAt(15.0, 0.0, 50.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("DANGER", risk.level());
        assertTrue(risk.summary().contains("Strong winds"));
    }

    @Test
    void moderateWindIsCaution() {
        Current cur = currentAt(15.0, 0.0, 30.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("CAUTION", risk.level());
        assertTrue(risk.summary().toLowerCase().contains("wind"));
    }

    @Test
    void heavyPrecipitationIsDanger() {
        Current cur = currentAt(15.0, 8.0, 10.0, 65);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("DANGER", risk.level());
        assertTrue(risk.summary().toLowerCase().contains("precipitation"));
    }

    @Test
    void lightPrecipitationIsCaution() {
        Current cur = currentAt(15.0, 2.0, 10.0, 61);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("CAUTION", risk.level());
    }

    @Test
    void subZeroTempIsDanger() {
        Current cur = currentAt(-8.0, 0.0, 10.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("DANGER", risk.level());
        assertTrue(risk.summary().toLowerCase().contains("sub-zero")
                || risk.summary().toLowerCase().contains("zero"));
    }

    @Test
    void coldButAboveFreezingIsCaution() {
        Current cur = currentAt(2.0, 0.0, 10.0, 1);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("CAUTION", risk.level());
        assertTrue(risk.summary().toLowerCase().contains("cold"));
    }

    @Test
    void snowForecastIsCautionAtLeast() {
        Current cur = currentAt(10.0, 0.0, 8.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of(
            hourAt("2026-05-29T18:00", 8.0, 0.0, 10.0, 71)
        ));
        assertNotEquals("OK", risk.level(),
            "Snow forecast should at least trigger CAUTION");
    }

    @Test
    void riskLevelTakesMaxOfCurrentAndHourly() {
        // Calm now, thunderstorm later -> overall DANGER
        Current cur = currentAt(15.0, 0.0, 5.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of(
            hourAt("2026-05-29T11:00", 16.0, 0.0, 6.0, 1),
            hourAt("2026-05-29T14:00", 18.0, 0.0, 8.0, 95)
        ));
        assertEquals("DANGER", risk.level());
    }

    @Test
    void cautionDoesNotOverrideDanger() {
        // Strong wind (DANGER) + cold (CAUTION) should remain DANGER
        Current cur = currentAt(3.0, 0.0, 45.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertEquals("DANGER", risk.level());
    }

    @Test
    void summaryNeverEmpty() {
        Current cur = currentAt(15.0, 0.0, 5.0, 0);
        WeatherRisk risk = service.assessRisk(cur, List.of());
        assertNotNull(risk.summary());
        assertFalse(risk.summary().isBlank(),
            "Even OK conditions must produce some summary text");
    }

    // ---- Helpers -----------------------------------------------------------

    private Current currentAt(double tempC, double precip, double wind, int code) {
        return new Current(tempC, precip, wind, code, service.describe(code));
    }

    private HourForecast hourAt(String time, double tempC, double precip, double wind, int code) {
        return new HourForecast(time, tempC, precip, wind, code, service.describe(code));
    }
}
