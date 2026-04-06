//! Rip Build Configuration

const std = @import("std");

const version = "0.1.0";

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // =========================================================================
    // Grammar — Parser Generator Tool
    // =========================================================================
    //
    // Builds the grammar tool that reads rip.grammar and generates
    // src/parser.zig (lexer + SLR(1) parser producing S-expressions).
    //
    // Usage:
    //   zig build grammar          — build the grammar tool
    //   ./bin/grammar rip.grammar src/parser.zig  — generate parser

    const grammar_mod = b.createModule(.{
        .root_source_file = b.path("src/grammar.zig"),
        .target = target,
        .optimize = optimize,
    });

    const grammar_exe = b.addExecutable(.{
        .name = "grammar",
        .root_module = grammar_mod,
    });

    const install_grammar = b.addInstallArtifact(grammar_exe, .{
        .dest_dir = .{ .override = .{ .custom = ".." } },
        .dest_sub_path = "bin/grammar",
    });

    const grammar_step = b.step("grammar", "Build grammar tool");
    grammar_step.dependOn(&install_grammar.step);

    // =========================================================================
    // Parser generation step
    // =========================================================================
    //
    // Runs the grammar tool to generate src/parser.zig from rip.grammar.
    //
    // Usage:
    //   zig build parser           — generate parser from grammar

    const gen_cmd = b.addRunArtifact(grammar_exe);
    gen_cmd.addArg("rip.grammar");
    gen_cmd.addArg("src/parser.zig");

    const parser_step = b.step("parser", "Generate parser from rip.grammar");
    parser_step.dependOn(&gen_cmd.step);

    // =========================================================================
    // Main executable — rip compiler driver
    // =========================================================================

    const main_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    const exe = b.addExecutable(.{
        .name = "rip",
        .root_module = main_mod,
    });

    const install_exe = b.addInstallArtifact(exe, .{
        .dest_dir = .{ .override = .{ .custom = ".." } },
        .dest_sub_path = "bin/rip",
    });
    b.getInstallStep().dependOn(&install_exe.step);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| run_cmd.addArgs(args);

    const run_step = b.step("run", "Run the Rip compiler");
    run_step.dependOn(&run_cmd.step);

    // =========================================================================
    // Tests
    // =========================================================================

    const test_step = b.step("test", "Run tests");

    const rip_test_mod = b.createModule(.{
        .root_source_file = b.path("src/rip.zig"),
        .target = target,
        .optimize = optimize,
    });
    const rip_tests = b.addTest(.{ .root_module = rip_test_mod });
    const run_rip_tests = b.addRunArtifact(rip_tests);
    test_step.dependOn(&run_rip_tests.step);
}
