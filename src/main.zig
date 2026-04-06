//! Rip Compiler — Bootstrap Driver
//!
//! Reads a .rip source file and parses it into S-expressions,
//! emits Zig source, or dumps the token stream for debugging.
//!
//! Usage:
//!   rip <file.rip>                — parse and print S-expressions
//!   rip --emit <file.rip>         — compile to Zig source
//!   rip -t, --tokens <file.rip>   — dump token stream

const std = @import("std");
const parser = @import("parser.zig");
const rip = @import("rip.zig");
const Compiler = @import("compiler.zig").Compiler;

const Mode = enum { parse, tokens, emit };

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var mode: Mode = .parse;
    var file_path: ?[]const u8 = null;

    for (args[1..]) |arg| {
        if (std.mem.eql(u8, arg, "-t") or std.mem.eql(u8, arg, "--tokens")) {
            mode = .tokens;
        } else if (std.mem.eql(u8, arg, "-e") or std.mem.eql(u8, arg, "--emit")) {
            mode = .emit;
        } else if (arg.len > 0 and arg[0] == '-') {
            std.debug.print("Unknown option: {s}\n", .{arg});
            std.process.exit(1);
        } else {
            file_path = arg;
        }
    }

    if (file_path == null) {
        std.debug.print("Usage: rip [options] <file.rip>\n  -e, --emit    Compile to Zig source\n  -t, --tokens  Dump token stream\n", .{});
        std.process.exit(1);
    }

    const source = std.fs.cwd().readFileAlloc(allocator, file_path.?, 1024 * 1024) catch |err| {
        std.debug.print("Error reading {s}: {}\n", .{ file_path.?, err });
        std.process.exit(1);
    };
    defer allocator.free(source);

    switch (mode) {
        .tokens => dumpTokens(source),
        .parse => try parseAndPrint(allocator, source),
        .emit => try compileAndEmit(allocator, source),
    }
}

fn dumpTokens(source: []const u8) void {
    var lexer = rip.Lexer.init(source);
    var i: u32 = 0;
    while (true) {
        const tok = lexer.next();
        const text = if (tok.len > 0) source[tok.pos..][0..tok.len] else "";
        std.debug.print("{d:3}: {s:15} pre={d} pos={d} len={d} \"{s}\"\n", .{
            i, @tagName(tok.cat), tok.pre, tok.pos, tok.len, text,
        });
        if (tok.cat == .eof) break;
        i += 1;
    }
}

fn parseAndPrint(allocator: std.mem.Allocator, source: []const u8) !void {
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

fn compileAndEmit(allocator: std.mem.Allocator, source: []const u8) !void {
    var p = parser.Parser.init(allocator, source);
    defer p.deinit();

    const result = p.parseProgram() catch {
        p.printError();
        std.process.exit(1);
    };

    var c = Compiler.init(source);

    var stdout_buffer: [4096]u8 = undefined;
    var stdout_writer = std.fs.File.stdout().writer(&stdout_buffer);
    const w: *std.Io.Writer = &stdout_writer.interface;
    try c.compile(result, w);
    try w.flush();
}
