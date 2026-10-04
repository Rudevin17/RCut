// Page Curl — ported from gl-transitions "InvertedPageCurl.glsl"
// Author: Hewlett-Packard (adapted by Sergey Kosarevsky)
// License: BSD 3 Clause
// Copyright (c) 2010 Hewlett-Packard Development Company, L.P. All rights reserved.
// The full BSD 3-Clause notice is reproduced in THIRD_PARTY_NOTICES.md.
// (Dead code from the original's behindSurface, whose results were always overwritten, is omitted.)
// RCut: shadows, the backside tint and alpha are scaled by the clips' coverage.

const CURL_MIN_AMOUNT: f32 = -0.16;
const CURL_MAX_AMOUNT: f32 = 1.5;
const CURL_PI: f32 = 3.141592653589793;
const CURL_SCALE: f32 = 512.0;
const CURL_SHARPNESS: f32 = 3.0;
const CURL_CYLINDER_RADIUS: f32 = 1.0 / CURL_PI / 2.0;

var<private> curl_amount: f32;
var<private> curl_cylinder_center: f32;
var<private> curl_cylinder_angle: f32;

fn curl_hit_point(hit_angle: f32, point_in: vec3f, rrotation: mat3x3f) -> vec3f {
    var point = point_in;
    point.y = hit_angle / (2.0 * CURL_PI);
    return rrotation * point;
}

fn curl_anti_alias(color1: vec4f, color2: vec4f, distance_in: f32) -> vec4f {
    let d = distance_in * CURL_SCALE;
    if (d < 0.0) {
        return color2;
    }
    if (d > 2.0) {
        return color1;
    }
    let dd = pow(1.0 - d / 2.0, CURL_SHARPNESS);
    return (color2 - color1) * dd + color1;
}

fn curl_distance_to_edge(point: vec3f) -> f32 {
    var dx = abs(select(point.x, 1.0 - point.x, point.x > 0.5));
    var dy = abs(select(point.y, 1.0 - point.y, point.y > 0.5));
    if (point.x < 0.0) {
        dx = -point.x;
    }
    if (point.x > 1.0) {
        dx = point.x - 1.0;
    }
    if (point.y < 0.0) {
        dy = -point.y;
    }
    if (point.y > 1.0) {
        dy = point.y - 1.0;
    }
    if ((point.x < 0.0 || point.x > 1.0) && (point.y < 0.0 || point.y > 1.0)) {
        return sqrt(dx * dx + dy * dy);
    }
    return min(dx, dy);
}

fn curl_see_through(yc: f32, p: vec2f, rotation: mat3x3f, rrotation: mat3x3f) -> vec4f {
    let hit_angle = CURL_PI - (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) - curl_cylinder_angle);
    let point = curl_hit_point(hit_angle, rotation * vec3f(p, 1.0), rrotation);
    if (yc <= 0.0 && (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0)) {
        return getToColor(p);
    }
    if (yc > 0.0) {
        return getFromColor(p);
    }
    let color = getFromColor(point.xy);
    return curl_anti_alias(color, vec4f(0.0), curl_distance_to_edge(point));
}

fn curl_see_through_with_shadow(
    yc: f32,
    p: vec2f,
    point: vec3f,
    rotation: mat3x3f,
    rrotation: mat3x3f,
) -> vec4f {
    var shadow = (1.0 - curl_distance_to_edge(point) * 30.0) / 3.0;
    if (shadow < 0.0) {
        shadow = 0.0;
    } else {
        shadow = shadow * curl_amount;
    }
    let shadow_color = curl_see_through(yc, p, rotation, rrotation);
    return vec4f(shadow_color.rgb - shadow, shadow_color.a);
}

fn curl_backside(yc: f32, point: vec3f) -> vec4f {
    let color = getFromColor(point.xy);
    var gray = (color.r + color.b + color.g) / 15.0;
    gray = gray + (8.0 / 10.0)
        * (pow(max(0.0, 1.0 - abs(yc / CURL_CYLINDER_RADIUS)), 2.0 / 10.0) / 2.0 + (5.0 / 10.0))
        * color.a;
    return vec4f(vec3f(gray), color.a);
}

fn curl_behind_surface(p: vec2f, yc_in: f32, point_in: vec3f, rrotation: mat3x3f) -> vec4f {
    let yc = -CURL_CYLINDER_RADIUS - CURL_CYLINDER_RADIUS - yc_in;
    let hit_angle = (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) + curl_cylinder_angle) - CURL_PI;
    let point = curl_hit_point(hit_angle, point_in, rrotation);

    var shado = 0.0;
    if (yc < 0.0 && point.x >= 0.0 && point.y >= 0.0 && point.x <= 1.0 && point.y <= 1.0
        && (hit_angle < CURL_PI || curl_amount > 0.5)) {
        let dx = point.x - 0.5;
        let dy = point.y - 0.5;
        shado = 1.0 - (sqrt(dx * dx + dy * dy) / (71.0 / 100.0));
        let nyc = -yc / CURL_CYLINDER_RADIUS;
        shado = shado * nyc * nyc * nyc * 0.5;
    }
    let to_color = getToColor(p);
    return vec4f(to_color.rgb - shado * to_color.a, to_color.a);
}

fn transition(p: vec2f) -> vec4f {
    curl_amount = progress * (CURL_MAX_AMOUNT - CURL_MIN_AMOUNT) + CURL_MIN_AMOUNT;
    curl_cylinder_center = curl_amount;
    curl_cylinder_angle = 2.0 * CURL_PI * curl_amount;

    let angle = 100.0 * CURL_PI / 180.0;
    let c1 = cos(-angle);
    let s1 = sin(-angle);
    let rotation = mat3x3f(
        vec3f(c1, s1, 0.0),
        vec3f(-s1, c1, 0.0),
        vec3f(-0.801, 0.8900, 1.0),
    );
    let c2 = cos(angle);
    let s2 = sin(angle);
    let rrotation = mat3x3f(
        vec3f(c2, s2, 0.0),
        vec3f(-s2, c2, 0.0),
        vec3f(0.98500, 0.985, 1.0),
    );

    var point = rotation * vec3f(p, 1.0);
    let yc = point.y - curl_cylinder_center;

    if (yc < -CURL_CYLINDER_RADIUS) {
        // Behind surface
        return curl_behind_surface(p, yc, point, rrotation);
    }
    if (yc > CURL_CYLINDER_RADIUS) {
        // Flat surface
        return getFromColor(p);
    }

    let hit_angle = (acos(clamp(yc / CURL_CYLINDER_RADIUS, -1.0, 1.0)) + curl_cylinder_angle) - CURL_PI;
    let hit_angle_mod = glsl_mod(hit_angle, 2.0 * CURL_PI);
    if ((hit_angle_mod > CURL_PI && curl_amount < 0.5) || (hit_angle_mod > CURL_PI / 2.0 && curl_amount < 0.0)) {
        return curl_see_through(yc, p, rotation, rrotation);
    }

    point = curl_hit_point(hit_angle, point, rrotation);
    if (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0) {
        return curl_see_through_with_shadow(yc, p, point, rotation, rrotation);
    }

    var color = curl_backside(yc, point);
    var other_color = getFromColor(p);
    if (yc < 0.0) {
        let dx2 = point.x - 0.5;
        let dy2 = point.y - 0.5;
        let nyc2 = -yc / CURL_CYLINDER_RADIUS;
        let shado = (1.0 - (sqrt(dx2 * dx2 + dy2 * dy2) / 0.71)) * nyc2 * nyc2 * nyc2 * 0.5;
        other_color = vec4f(0.0, 0.0, 0.0, shado * other_color.a);
    }
    color = curl_anti_alias(color, other_color, CURL_CYLINDER_RADIUS - abs(yc));

    let cl = curl_see_through_with_shadow(yc, p, point, rotation, rrotation);
    return curl_anti_alias(color, cl, curl_distance_to_edge(point));
}
