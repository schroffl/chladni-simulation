const std = @import("std");
const Mesh = @import("./mesh.zig");

extern "debug" fn js_err(ptr: [*]const u8, len: usize) void;
extern "debug" fn js_log(ptr: [*]const u8, len: usize) void;

pub fn panic(err: []const u8, maybe_trace: ?*std.builtin.StackTrace) noreturn {
    _ = maybe_trace;
    js_err(err.ptr, err.len);
    while (true) @breakpoint();
}

// This is partially copied from the default log implementation in the standard library.
pub fn log(
    comptime level: std.log.Level,
    comptime scope: @TypeOf(.EnumLiteral),
    comptime fmt: []const u8,
    args: anytype,
) void {
    const level_txt = switch (level) {
        .err => "error",
        .warn => "warning",
        .info => "info",
        .debug => "debug",
    };
    const prefix2 = if (scope == .default) ": " else "(" ++ @tagName(scope) ++ "): ";
    const format = level_txt ++ prefix2 ++ fmt;
    const log_allocator = std.heap.page_allocator;

    const log_buffer = std.fmt.allocPrint(log_allocator, format, args) catch |err| {
        const err_msg = @errorName(err);
        const msg = "Failed to format log message";
        js_err(msg, msg.len);
        js_err(@ptrCast([*]const u8, err_msg), err_msg.len);
        return;
    };

    js_log(log_buffer.ptr, log_buffer.len);
    log_allocator.free(log_buffer);
}

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
var allocator = gpa.allocator();

var mesh: Mesh = undefined;
var target: *Mesh.Point = undefined;

export fn allocBuffer(size: usize) [*]u8 {
    const buf = allocator.alloc(u8, size) catch unreachable;
    return buf.ptr;
}

export fn freeBuffer(ptr: [*]u8, len: usize) void {
    const buf = ptr[0..len];
    allocator.free(buf);
}

export fn js_init(width: usize, height: usize, spacing: f32, tension: f32, iterations: usize) void {
    const config = Mesh.Config{
        .width = width,
        .height = height,
        .spacing = spacing,
        // .tension = std.math.epsilon(f32),
        .tension = tension,
        .iterations = iterations,
    };

    mesh = Mesh.init(allocator, config) catch unreachable;
    target = mesh.getPoint(@intCast(isize, width / 2), @intCast(isize, height / 2)).?;
    target.fixed = true;
}

export fn js_process(t: f32, ptr: [*]f32, len: usize) void {
    const buf = ptr[0..len];

    for (buf) |sample| {
        target.position.y = sample;
        mesh.step(t);
    }
}

export fn js_fillVertexBuffer(ptr: [*]f32, len: usize) void {
    const out = ptr[0..len];
    mesh.fillVertexBuffer(out);
}

export fn js_setTension(tension: f32) void {
    mesh.config.tension = tension;
}

export fn js_setIterations(iterations: usize) void {
    mesh.config.iterations = iterations;
}
