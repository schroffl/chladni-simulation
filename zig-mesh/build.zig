const std = @import("std");

pub fn build(b: *std.build.Builder) void {
    const lib_step = b.addSharedLibrary(.{
        .name = "zig-mesh",
        .root_source_file = .{ .path = "src/main.zig" },
        .optimize = .ReleaseFast,
        .target = .{
            .cpu_arch = .wasm32,
            .os_tag = .freestanding,
        },
    });

    // Needed to make the exported functions available to JavaScript.
    lib_step.rdynamic = true;

    b.installArtifact(lib_step);
}
