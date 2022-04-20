const std = @import("std");
const Self = @This();

x: f32,
y: f32,
z: f32,

pub fn init(x: f32, y: f32, z: f32) Self {
    return Self{ .x = x, .y = y, .z = z };
}

pub fn add(a: Self, b: Self) Self {
    return Self{
        .x = a.x + b.x,
        .y = a.y + b.y,
        .z = a.z + b.z,
    };
}

pub fn subtract(a: Self, b: Self) Self {
    return Self{
        .x = a.x - b.x,
        .y = a.y - b.y,
        .z = a.z - b.z,
    };
}

pub fn scale(a: Self, by: f32) Self {
    return Self{
        .x = a.x * by,
        .y = a.y * by,
        .z = a.z * by,
    };
}

pub fn length(self: Self) f32 {
    return std.math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z);
}

pub fn multiply(a: Self, b: Self) Self {
    return Self{
        .x = a.x * b.x,
        .y = a.y * b.y,
        .z = a.z * b.z,
    };
}

pub fn cross(a: Self, b: Self) Self {
    return Self{
        .x = a.y * b.z - a.z * b.y,
        .y = a.z * b.x - a.x * b.z,
        .z = a.x * b.y - a.y * b.x,
    };
}
