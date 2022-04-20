const std = @import("std");

pub fn build(b: *std.build.Builder) void {
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    const mode = b.standardReleaseOptions();

    const lib_step = b.addSharedLibrary("zig-mesh", "src/main.zig", .{
        .unversioned = {},
    });

    lib_step.setTarget(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    lib_step.setBuildMode(mode);
    lib_step.install();
}
