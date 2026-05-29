package com.hikerAid.service;

import com.hikerAid.model.*;
import org.springframework.stereotype.Service;
import org.w3c.dom.*;
import javax.xml.parsers.*;
import java.io.InputStream;
import java.util.*;

@Service
public class GpxParserService {

    public GpxData parse(InputStream inputStream) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        // XXE prevention
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setExpandEntityReferences(false);

        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(inputStream);
        doc.getDocumentElement().normalize();

        Element root = doc.getDocumentElement();
        String creator = root.getAttribute("creator");

        String name = firstDescendantText(root, "metadata", "name");
        String desc = firstDescendantText(root, "metadata", "desc");

        List<List<TrackPoint>> segments = new ArrayList<>();
        NodeList trkList = root.getElementsByTagName("trk");
        for (int i = 0; i < trkList.getLength(); i++) {
            Element trk = (Element) trkList.item(i);
            if (name == null) name = directChildText(trk, "name");
            NodeList segList = trk.getElementsByTagName("trkseg");
            for (int j = 0; j < segList.getLength(); j++) {
                List<TrackPoint> pts = parsePoints(((Element) segList.item(j)).getElementsByTagName("trkpt"));
                if (!pts.isEmpty()) segments.add(pts);
            }
        }

        if (segments.isEmpty()) {
            NodeList rteList = root.getElementsByTagName("rte");
            for (int i = 0; i < rteList.getLength(); i++) {
                List<TrackPoint> pts = parsePoints(((Element) rteList.item(i)).getElementsByTagName("rtept"));
                if (!pts.isEmpty()) {
                    if (name == null) name = directChildText((Element) rteList.item(i), "name");
                    segments.add(pts);
                }
            }
        }

        List<WaypointData> waypoints = new ArrayList<>();
        NodeList wptList = root.getElementsByTagName("wpt");
        for (int i = 0; i < wptList.getLength(); i++) {
            Element wpt = (Element) wptList.item(i);
            double lat = Double.parseDouble(wpt.getAttribute("lat"));
            double lon = Double.parseDouble(wpt.getAttribute("lon"));
            waypoints.add(new WaypointData(
                lat, lon,
                directChildText(wpt, "name"),
                directChildText(wpt, "desc"),
                directChildText(wpt, "sym"),
                directChildText(wpt, "type")
            ));
        }

        return new GpxData(
            name != null ? name.trim() : "Unnamed Route",
            desc,
            creator,
            segments,
            waypoints
        );
    }

    private List<TrackPoint> parsePoints(NodeList nodes) {
        List<TrackPoint> points = new ArrayList<>(nodes.getLength());
        for (int i = 0; i < nodes.getLength(); i++) {
            Element pt = (Element) nodes.item(i);
            try {
                double lat = Double.parseDouble(pt.getAttribute("lat"));
                double lon = Double.parseDouble(pt.getAttribute("lon"));
                String eleStr = directChildText(pt, "ele");
                Double ele = eleStr != null ? Double.parseDouble(eleStr) : null;
                String time = directChildText(pt, "time");
                Integer cad = parseIntFromDescendant(pt, "cad");
                points.add(new TrackPoint(lat, lon, ele, time, cad));
            } catch (NumberFormatException ignored) {}
        }
        return points;
    }

    private Integer parseIntFromDescendant(Element parent, String tagName) {
        NodeList nodes = parent.getElementsByTagName(tagName);
        if (nodes.getLength() == 0) {
            String[] prefixes = {"gpxtpx:", "ns3:", "gpxdata:"};
            for (String prefix : prefixes) {
                nodes = parent.getElementsByTagName(prefix + tagName);
                if (nodes.getLength() > 0) break;
            }
        }
        if (nodes.getLength() > 0) {
            try { return Integer.parseInt(nodes.item(0).getTextContent().trim()); }
            catch (NumberFormatException ignored) {}
        }
        return null;
    }

    private String directChildText(Element parent, String tagName) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (child.getNodeType() == Node.ELEMENT_NODE) {
                String localName = child.getLocalName() != null ? child.getLocalName() : child.getNodeName();
                if (localName.equals(tagName)) {
                    String text = child.getTextContent();
                    return text != null ? text.trim() : null;
                }
            }
        }
        return null;
    }

    private String firstDescendantText(Element root, String containerTag, String childTag) {
        NodeList containers = root.getElementsByTagName(containerTag);
        if (containers.getLength() == 0) return null;
        return directChildText((Element) containers.item(0), childTag);
    }
}
