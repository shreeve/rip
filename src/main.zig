//! Rip Compiler — Bootstrap Driver
//!
//! Reads a .rip source file, parses it into S-expressions, and prints
//! the resulting tree. This is the first end-to-end test of the
//! rip.grammar -> grammar.zig -> parser.zig pipeline.

const std = @import("std");
const parser = @import("parser.zig");

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        std.debug.print("Usage: rip <file.rip>\n", .{});
        std.process.exit(1);
    }

    const file_path = args[1];
    const source = std.fs.cwd().readFileAlloc(allocator, file_path, 1024 * 1024) catch |err| {
        std.debug.print("Error reading {s}: {}\n", .{ file_path, err });
        std.process.exit(1);
    };
    defer allocator.free(source);

    var p = parser.Parser.init(allocator, source);
    defer p.deinit();

    const result = p.parseProgram() catch {
        p.printError();
        std.process.exit(1);
    };

    var stdout_buffer: [4096]u8 = undefined;
    var stdout_writer = std.fs.File.stdout().writer(&stdout_buffer);
    const w: *std.Io.Writer = &stdout_writer.interface;
    try result.write(source, w);
    try w.writeAll("\n");
    try w.flush();
}
