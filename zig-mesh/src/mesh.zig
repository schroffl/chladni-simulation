const std = @import("std");
const Vec3 = @import("./vec3.zig");
const Mesh = @This();

pub const Config = struct {
    width: usize,
    height: usize,
    iterations: usize = 1,
    tension: f32 = 1,
    spacing: f32 = 1,
    return_to_plane: f32 = 0.0,
};

pub const Point = struct {
    position: Vec3,
    fixed: bool = false,
};

allocator: std.mem.Allocator,
points: []Point,
config: Config,

pub fn init(allocator: std.mem.Allocator, config: Config) !Mesh {
    var self = Mesh{
        .allocator = allocator,
        .points = try allocator.alloc(Point, config.width * config.height),
        .config = config,
    };

    var x: usize = 0;

    while (x < config.width) : (x += 1) {
        var y: usize = 0;

        while (y < config.height) : (y += 1) {
            const idx = y * config.width + x;

            const px = @as(f32, @floatFromInt(x)) - @as(f32, @floatFromInt(config.width)) / 2;
            const py = @as(f32, @floatFromInt(y)) - @as(f32, @floatFromInt(config.height)) / 2;

            const is_edge = x == 0 or x == config.width - 1 or y == 0 or y == config.height - 1;
            _ = is_edge;

            const is_corner = (x == 0 and y == 0) or (x == 0 and y == config.height - 1) or (x == config.width - 1 and y == 0) or (x == config.width - 1 and y == config.height - 1);

            self.points[idx] = Point{
                .position = Vec3.init(px * config.spacing, 0, py * config.spacing),
                .fixed = is_corner,
            };
        }
    }

    return self;
}

pub fn deinit(self: *Mesh) void {
    self.allocator.free(self.points);
}

pub fn step(self: *Mesh, t: f32) void {
    const tension = self.config.tension;
    const width = self.config.width;
    const height = self.config.width;

    _ = t;

    var iteration: usize = self.config.iterations;

    while (iteration > 0) : (iteration -= 1) {
        var x: isize = 0;

        while (x < width) : (x += 1) {
            var y: isize = 0;

            while (y < height) : (y += 1) {
                const p1 = self.getPoint(x, y) orelse {
                    std.log.err("Failed to get point at ({}, {})", .{ x, y });
                    continue;
                };

                // Structural constraints
                if (self.getPoint(x - 1, y)) |p2| satisfy(p1, p2, tension);
                if (self.getPoint(x + 1, y)) |p2| satisfy(p1, p2, tension);
                if (self.getPoint(x, y - 1)) |p2| satisfy(p1, p2, tension);
                if (self.getPoint(x, y + 1)) |p2| satisfy(p1, p2, tension);

                // Because the shear constraints are diagonal we need to scale the tension
                // by the square root of 2
                if (self.getPoint(x - 1, y - 1)) |p2| satisfy(p1, p2, tension * std.math.sqrt2);
                if (self.getPoint(x + 1, y - 1)) |p2| satisfy(p1, p2, tension * std.math.sqrt2);
                if (self.getPoint(x - 1, y + 1)) |p2| satisfy(p1, p2, tension * std.math.sqrt2);
                if (self.getPoint(x + 1, y + 1)) |p2| satisfy(p1, p2, tension * std.math.sqrt2);
            }
        }
    }

    for (self.points) |*point| {
        if (!point.fixed) {
            point.position.y -= point.position.y * self.config.return_to_plane;
        }
    }
}

pub fn getPoint(self: *Mesh, x: isize, y: isize) ?*Point {
    @setRuntimeSafety(false);

    if (x >= 0 and x < self.config.width and y >= 0 and y < self.config.height) {
        const w = @as(isize, @intCast(self.config.width));
        const idx = @as(usize, @intCast(y * w + x));
        return &self.points[idx];
    }

    return null;
}

pub fn fillVertexBuffer(self: *Mesh, out: []f32) void {
    const required = self.points.len * 3 * 2;

    if (out.len < required) {
        std.log.err("Failed to fill vertex buffer: Not enough space for all points", .{});
        return;
    }

    const width = @as(isize, @intCast(self.config.width));
    const height = self.config.height;

    var x: isize = 0;

    while (x < width) : (x += 1) {
        var y: isize = 0;

        while (y < height) : (y += 1) {
            const idx = @as(usize, @intCast(y * width + x)) * 6;
            const point = self.getPoint(x, y).?;
            const pos = point.position;

            out[idx + 0] = pos.x;
            out[idx + 1] = pos.y * 10;
            out[idx + 2] = pos.z;

            // const right = if (self.getPoint(x + 1, y)) |p| p.position else Vec3.init(@as(f32, @floatFromInt(x)) + 1, point.position.y, @as(f32, @floatFromInt(y)));
            // const bottom = if (self.getPoint(x, y + y)) |p| p.position else Vec3.init(@as(f32, @floatFromInt(x)), point.position.y, @as(f32, @floatFromInt(y)) + 1);

            // const cross_product = Vec3.cross(
            //     right.subtract(point.position),
            //     bottom.subtract(point.position),
            // );

            // const normal = cross_product.scale(1.0 / cross_product.length());

            // out[idx + 3] = normal.x;
            // out[idx + 4] = normal.y;
            // out[idx + 5] = normal.z;
        }
    }
}

fn satisfy(p1: *Point, p2: *Point, rest_length: f32) void {
    // Both points are fixed: There's no way to satisfy the constraint.
    if (p1.fixed and p2.fixed) {
        return;
    }

    const delta = p2.position.subtract(p1.position);
    const dist = delta.length();

    const fixed_mass: f32 = 0;
    const mass_p1: f32 = if (p1.fixed) fixed_mass else 1;
    const mass_p2: f32 = if (p2.fixed) fixed_mass else 1;

    const diff = (dist - rest_length) / ((rest_length + dist) * (mass_p1 + mass_p2));
    const force_scale = Vec3.init(0, 1, 0);

    const dir_p1 = delta.scale(mass_p1 * diff).multiply(force_scale);
    p1.position = p1.position.add(dir_p1);

    const dir_p2 = delta.scale(mass_p2 * diff).multiply(force_scale);
    p2.position = p2.position.subtract(dir_p2);
}
