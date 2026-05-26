package com.hikerAid.service;

import com.hikerAid.model.*;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;

@Service
public class RouteAnalysisService {

    private static final double EARTH_RADIUS_M = 6371000.0;
    private static final double TOBLER_BASE_SPEED = 6.0;
    private static final int MAX_GRADIENT_SEGMENTS = 2000;
    private static final int MAX_ELEVATION_PROFILE_POINTS = 500;
    private static final int MAX_TRACK_POINTS = 5000;
    private static final double ELEVATION_DEADBAND_M = 3.0;
    private static final int SAFETY_BUFFER_MINUTES = 30;

    public AnalysisResult analyze(GpxData data) {
        return analyzeWithWeight(data, 70.0, 170.0, 3, 8, 0);
    }

    public AnalysisResult analyzeWithWeight(GpxData data, double weightKg, double heightCm, int fitnessLevel, int startHour, int startMinute) {
        List<TrackPoint> points = flatten(data.segments());
        double paceFactor = paceFactorForLevel(fitnessLevel);

        if (points.size() < 2) {
            return new AnalysisResult(data.name(), data.description(),
                emptyStats(points.size()), List.of(), List.of(), List.of(), data.waypoints(), null);
        }

        double[] cumDist = new double[points.size()];
        double[] rawGradients = new double[points.size()];

        double maxEle = -Double.MAX_VALUE, minEle = Double.MAX_VALUE;
        double maxAbsGradient = 0;
        boolean hasEle = false, hasHr = false, hasTime = false;

        long hrSum = 0;
        int hrCount = 0;
        int maxHr = 0;

        if (points.get(0).elevation() != null) {
            hasEle = true;
            maxEle = points.get(0).elevation();
            minEle = points.get(0).elevation();
        }
        if (points.get(0).heartRate() != null) {
            hasHr = true;
            hrSum += points.get(0).heartRate();
            hrCount++;
            maxHr = points.get(0).heartRate();
        }

        for (int i = 1; i < points.size(); i++) {
            TrackPoint prev = points.get(i - 1);
            TrackPoint curr = points.get(i);

            double hDist = haversine(prev.lat(), prev.lon(), curr.lat(), curr.lon());
            cumDist[i] = cumDist[i - 1] + hDist;

            if (curr.elevation() != null && prev.elevation() != null) {
                hasEle = true;
                double vDiff = curr.elevation() - prev.elevation();

                maxEle = Math.max(maxEle, curr.elevation());
                minEle = Math.min(minEle, curr.elevation());

                if (hDist > 0.5) {
                    double g = (vDiff / hDist) * 100.0;
                    rawGradients[i] = Math.max(-60, Math.min(60, g));
                } else {
                    rawGradients[i] = i > 1 ? rawGradients[i - 1] : 0;
                }
                maxAbsGradient = Math.max(maxAbsGradient, Math.abs(rawGradients[i]));
            }

            if (curr.heartRate() != null) {
                hasHr = true;
                hrSum += curr.heartRate();
                hrCount++;
                maxHr = Math.max(maxHr, curr.heartRate());
            }
            if (curr.time() != null) hasTime = true;
        }

        if (!hasEle) { maxEle = 0; minEle = 0; }

        double[] ascentDescent = computeElevationGainLoss(points);
        double totalAscent = ascentDescent[0];
        double totalDescent = ascentDescent[1];

        double totalDistKm = cumDist[points.size() - 1] / 1000.0;

        double[] smoothGradients = smooth(rawGradients, cumDist);

        long baseMovingMinutes = estimateTimeMinutes(points, cumDist);
        long movingMinutes = Math.round(baseMovingMinutes / paceFactor);
        long totalMinutes = addRestBreaks(movingMinutes);
        double avgSpeedKmh = movingMinutes > 0 ? totalDistKm / (movingMinutes / 60.0) : 0;

        int diffScore = difficultyScore(totalDistKm, totalAscent, maxAbsGradient);
        double calories = estimateCalories(weightKg, heightCm, totalDistKm, totalAscent, totalDescent, movingMinutes);

        Integer avgHr = hrCount > 0 ? (int) (hrSum / hrCount) : null;
        Integer maxHrVal = hrCount > 0 ? maxHr : null;

        RouteStats stats = new RouteStats(
            round2(totalDistKm),
            round1(totalAscent),
            round1(totalDescent),
            round1(maxEle),
            round1(minEle),
            round1(maxAbsGradient),
            movingMinutes,
            totalMinutes,
            difficultyLabel(diffScore),
            diffScore,
            Math.round(calories),
            points.size(),
            round1(avgSpeedKmh),
            hasEle,
            hasHr,
            hasTime,
            avgHr,
            maxHrVal
        );

        List<double[]> trackPts = buildTrackPoints(points);
        List<double[]> gradientSegs = buildGradientSegments(points, smoothGradients);
        List<ElevationPoint> profile = buildElevationProfile(points, cumDist, smoothGradients, hasEle);

        int startMinutesOfDay = startHour * 60 + startMinute;
        int dayOfYear = LocalDate.now().getDayOfYear();
        SafetyAnalysis safety = computeSafety(points, cumDist, paceFactor, fitnessLevel, startMinutesOfDay, dayOfYear);

        return new AnalysisResult(data.name(), data.description(), stats,
            trackPts, gradientSegs, profile, data.waypoints(), safety);
    }

    // ── Safety analysis ─────────────────────────────────────────────────────

    private SafetyAnalysis computeSafety(
            List<TrackPoint> points, double[] cumDist,
            double paceFactor, int fitnessLevel,
            int startMinutesOfDay, int dayOfYear) {

        int n = points.size();

        double[] fwdSegMin = new double[n];
        double[] revSegMin = new double[n];

        for (int i = 1; i < n; i++) {
            double hDist = cumDist[i] - cumDist[i - 1];
            if (hDist < 0.1) continue;

            double slope = 0;
            if (points.get(i).elevation() != null && points.get(i - 1).elevation() != null) {
                slope = (points.get(i).elevation() - points.get(i - 1).elevation()) / hDist;
            }

            double distKm = hDist / 1000.0;
            fwdSegMin[i] = (distKm / toblerSpeed(slope)) * 60.0 / paceFactor;
            revSegMin[i] = (distKm / toblerSpeed(-slope)) * 60.0 / paceFactor;
        }

        double[] forwardMin = new double[n];
        double[] reverseMin = new double[n];
        for (int i = 1; i < n; i++) {
            forwardMin[i] = forwardMin[i - 1] + fwdSegMin[i];
            reverseMin[i] = reverseMin[i - 1] + revSegMin[i];
        }

        long personalizedMoving = Math.round(forwardMin[n - 1]);
        long personalizedTotal = addRestBreaks(personalizedMoving);

        double routeLat = points.get(0).lat();
        int sunsetMinutes = estimateSunsetMinutes(routeLat, dayOfYear);
        String sunsetStr = formatMinutesAsTime(sunsetMinutes);

        int availableMinutes = sunsetMinutes - startMinutesOfDay - SAFETY_BUFFER_MINUTES;
        int marginMinutes = availableMinutes - (int) personalizedTotal;
        boolean sufficient = marginMinutes >= 0;

        int turnaroundFullIdx = 0;
        if (availableMinutes > 0) {
            for (int i = 0; i < n; i++) {
                double roundTrip = forwardMin[i] + reverseMin[i];
                double withRest = roundTrip + addRestDelta(roundTrip);
                if (withRest <= availableMinutes) {
                    turnaroundFullIdx = i;
                }
            }
        }

        double totalForwardMin = forwardMin[n - 1];
        int pnrFullIdx = n - 1;
        for (int i = 0; i < n; i++) {
            double remainingForward = totalForwardMin - forwardMin[i];
            if (remainingForward <= reverseMin[i]) {
                pnrFullIdx = i;
                break;
            }
        }

        int trackStep = Math.max(1, n / MAX_TRACK_POINTS);
        int maxTrackIdx = (n - 1) / trackStep;
        int turnaroundTrackIdx = Math.min(turnaroundFullIdx / trackStep, maxTrackIdx);
        int pnrTrackIdx = Math.min(pnrFullIdx / trackStep, maxTrackIdx);

        return new SafetyAnalysis(
            paceFactor,
            fitnessLabel(fitnessLevel),
            personalizedMoving,
            personalizedTotal,
            sunsetStr,
            Math.max(0, availableMinutes),
            marginMinutes,
            sufficient,
            round2(cumDist[turnaroundFullIdx] / 1000.0),
            turnaroundTrackIdx,
            round2(cumDist[pnrFullIdx] / 1000.0),
            pnrTrackIdx
        );
    }

    private int estimateSunsetMinutes(double latDeg, int dayOfYear) {
        double latRad = Math.toRadians(latDeg);
        double declRad = Math.toRadians(-23.45 * Math.cos(Math.toRadians(360.0 / 365.0 * (dayOfYear + 10))));
        double cosHA = -Math.tan(latRad) * Math.tan(declRad);
        cosHA = Math.max(-1, Math.min(1, cosHA));
        double hourAngle = Math.acos(cosHA);
        double sunsetHour = 12.0 + hourAngle * 12.0 / Math.PI;
        if (latDeg > 0 && dayOfYear >= 80 && dayOfYear <= 300) sunsetHour += 1.0;
        if (latDeg < 0 && (dayOfYear >= 274 || dayOfYear <= 90)) sunsetHour += 1.0;
        return (int) Math.round(sunsetHour * 60);
    }

    private double paceFactorForLevel(int level) {
        return switch (level) {
            case 1 -> 0.6;
            case 2 -> 0.8;
            case 4 -> 1.15;
            case 5 -> 1.3;
            default -> 1.0;
        };
    }

    private String fitnessLabel(int level) {
        return switch (level) {
            case 1 -> "Beginner";
            case 2 -> "Below average";
            case 4 -> "Fit";
            case 5 -> "Very fit";
            default -> "Average";
        };
    }

    private String formatMinutesAsTime(int totalMinutes) {
        int h = (totalMinutes / 60) % 24;
        int m = totalMinutes % 60;
        return String.format("%02d:%02d", h, m);
    }

    private double addRestDelta(double movingMinutes) {
        if (movingMinutes <= 60) return 0;
        return (movingMinutes / 60.0) * 10;
    }

    // ── Elevation ───────────────────────────────────────────────────────────

    private double[] computeElevationGainLoss(List<TrackPoint> points) {
        double totalAscent = 0, totalDescent = 0;
        double accumUp = 0, accumDown = 0;
        Double lastEle = null;

        for (TrackPoint p : points) {
            if (p.elevation() == null) continue;
            if (lastEle == null) { lastEle = p.elevation(); continue; }

            double diff = p.elevation() - lastEle;
            lastEle = p.elevation();

            if (diff > 0) {
                if (accumDown > ELEVATION_DEADBAND_M) totalDescent += accumDown;
                accumDown = 0;
                accumUp += diff;
            } else if (diff < 0) {
                if (accumUp > ELEVATION_DEADBAND_M) totalAscent += accumUp;
                accumUp = 0;
                accumDown += -diff;
            }
        }
        if (accumUp > ELEVATION_DEADBAND_M) totalAscent += accumUp;
        if (accumDown > ELEVATION_DEADBAND_M) totalDescent += accumDown;

        return new double[]{totalAscent, totalDescent};
    }

    // ── Time ────────────────────────────────────────────────────────────────

    private double toblerSpeed(double slope) {
        double speed = TOBLER_BASE_SPEED * Math.exp(-3.5 * Math.abs(slope + 0.05));
        return Math.max(0.3, Math.min(8.0, speed));
    }

    private long estimateTimeMinutes(List<TrackPoint> points, double[] cumDist) {
        double totalHours = 0;
        for (int i = 1; i < points.size(); i++) {
            double hDistM = cumDist[i] - cumDist[i - 1];
            if (hDistM < 0.1) continue;
            double slope = 0;
            if (points.get(i).elevation() != null && points.get(i - 1).elevation() != null) {
                slope = (points.get(i).elevation() - points.get(i - 1).elevation()) / hDistM;
            }
            totalHours += (hDistM / 1000.0) / toblerSpeed(slope);
        }
        return Math.round(totalHours * 60);
    }

    private long addRestBreaks(long movingMinutes) {
        if (movingMinutes <= 60) return movingMinutes;
        return Math.round(movingMinutes + (movingMinutes / 60.0) * 10);
    }

    // ── Scoring ─────────────────────────────────────────────────────────────

    private int difficultyScore(double distKm, double ascent, double maxGrad) {
        double d = Math.min(distKm * 2.0, 40);
        double a = Math.min(ascent / 50.0, 40);
        double g = Math.min(maxGrad / 2.5, 20);
        return (int) Math.round(d + a + g);
    }

    private String difficultyLabel(int score) {
        if (score < 10)  return "Easy";
        if (score < 25)  return "Moderate";
        if (score < 45)  return "Hard";
        if (score < 65)  return "Very Hard";
        return "Extreme";
    }

    private double estimateCalories(double weightKg, double heightCm, double distKm, double ascentM, double descentM, long movingMinutes) {
        // Stride efficiency: taller hikers are ~5% more efficient per 10cm above average
        double heightFactor = 1.0 - (heightCm - 170) * 0.005;
        heightFactor = Math.max(0.85, Math.min(1.15, heightFactor));

        double flat = weightKg * distKm * 0.7 * heightFactor;
        double climb = ascentM * weightKg * 0.01;
        double descent = descentM * weightKg * 0.003;

        // BMR during activity (simplified Mifflin-St Jeor, gender-neutral, ~age 35)
        double bmrPerHour = (10 * weightKg + 6.25 * heightCm - 200) / 24.0;
        double bmrDuringHike = bmrPerHour * (movingMinutes / 60.0);

        return flat + climb + descent + bmrDuringHike;
    }

    // ── Output builders ─────────────────────────────────────────────────────

    private List<double[]> buildTrackPoints(List<TrackPoint> points) {
        int step = Math.max(1, points.size() / MAX_TRACK_POINTS);
        List<double[]> out = new ArrayList<>(points.size() / step + 1);
        for (int i = 0; i < points.size(); i += step) {
            TrackPoint p = points.get(i);
            out.add(new double[]{p.lat(), p.lon()});
        }
        if ((points.size() - 1) % step != 0) {
            TrackPoint last = points.get(points.size() - 1);
            out.add(new double[]{last.lat(), last.lon()});
        }
        return out;
    }

    private List<double[]> buildGradientSegments(List<TrackPoint> points, double[] gradients) {
        int step = Math.max(1, (points.size() - 1) / MAX_GRADIENT_SEGMENTS);
        List<double[]> out = new ArrayList<>();
        for (int i = step; i < points.size(); i += step) {
            TrackPoint p1 = points.get(i - step);
            TrackPoint p2 = points.get(i);
            double avgGrad = 0;
            for (int j = i - step + 1; j <= i; j++) avgGrad += gradients[j];
            avgGrad /= step;
            out.add(new double[]{p1.lat(), p1.lon(), p2.lat(), p2.lon(), avgGrad});
        }
        int lastCovered = ((points.size() - 1) / step) * step;
        if (lastCovered < points.size() - 1) {
            TrackPoint p1 = points.get(lastCovered);
            TrackPoint p2 = points.get(points.size() - 1);
            double avgGrad = 0;
            int count = 0;
            for (int j = lastCovered + 1; j < points.size(); j++) { avgGrad += gradients[j]; count++; }
            if (count > 0) avgGrad /= count;
            out.add(new double[]{p1.lat(), p1.lon(), p2.lat(), p2.lon(), avgGrad});
        }
        return out;
    }

    private List<ElevationPoint> buildElevationProfile(List<TrackPoint> points, double[] cumDist, double[] gradients, boolean hasEle) {
        if (!hasEle) return List.of();
        int step = Math.max(1, points.size() / MAX_ELEVATION_PROFILE_POINTS);
        List<ElevationPoint> out = new ArrayList<>();
        for (int i = 0; i < points.size(); i += step) {
            Double ele = points.get(i).elevation();
            if (ele != null) {
                out.add(new ElevationPoint(
                    round2(cumDist[i] / 1000.0),
                    round1(ele),
                    round1(gradients[i])
                ));
            }
        }
        if ((points.size() - 1) % step != 0) {
            Double ele = points.get(points.size() - 1).elevation();
            if (ele != null) {
                out.add(new ElevationPoint(
                    round2(cumDist[points.size() - 1] / 1000.0),
                    round1(ele),
                    round1(gradients[points.size() - 1])
                ));
            }
        }
        return out;
    }

    private double[] smooth(double[] data, double[] cumDist) {
        double totalDist = cumDist[cumDist.length - 1];
        double avgPointDist = data.length > 1 ? totalDist / (data.length - 1) : 1;
        int window = Math.max(3, Math.min(15, (int) (50.0 / Math.max(avgPointDist, 0.1))));
        if (window % 2 == 0) window++;

        double[] out = new double[data.length];
        for (int i = 0; i < data.length; i++) {
            int start = Math.max(0, i - window / 2);
            int end = Math.min(data.length - 1, i + window / 2);
            double sum = 0;
            for (int j = start; j <= end; j++) sum += data[j];
            out[i] = sum / (end - start + 1);
        }
        return out;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private List<TrackPoint> flatten(List<List<TrackPoint>> segments) {
        List<TrackPoint> all = new ArrayList<>();
        for (List<TrackPoint> seg : segments) all.addAll(seg);
        return all;
    }

    private double haversine(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private RouteStats emptyStats(int pointCount) {
        return new RouteStats(0, 0, 0, 0, 0, 0, 0, 0, "Unknown", 0, 0, pointCount, 0,
            false, false, false, null, null);
    }

    private double round1(double v) { return Math.round(v * 10.0) / 10.0; }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
