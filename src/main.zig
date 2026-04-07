//! Rip Compiler — Bootstrap Driver
//!
//! Reads a .rip source file and parses it into S-expressions,
//! compiles to Zig source, or runs the result end-to-end.
//!
//! Usage:
//!   rip <file.rip>                 — parse and print S-expressions
//!   rip -c, --compile <file.rip>   — compile to Zig source
//!   rip -r, --run <file.rip>       — compile and run via zig
//!   rip -t, --tokens <file.rip>    — dump token stream

const std = @import("std");
const parser = @import("parser.zig");
const rip = @import("rip.zig");
const Compiler = @import("compiler.zig").Compiler;

const Mode = enum { parse, compile, run, tokens };

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var mode: Mode = .parse;
    var file_path: ?[]const u8 = null;

    for (args[1..]) |arg| {
        if (std.mem.eql(u8, arg, "-c") or std.mem.eql(u8, arg, "--compile")) {
            mode = .compile;
        } else if (std.mem.eql(u8, arg, "-r") or std.mem.eql(u8, arg, "--run")) {
            mode = .run;
        } else if (std.mem.eql(u8, arg, "-t") or std.mem.eql(u8, arg, "--tokens")) {
            mode = .tokens;
        } else if (arg.len > 0 and arg[0] == '-') {
            std.debug.print("Unknown option: {s}\n", .{arg});
            std.process.exit(1);
        } else {
            file_path = arg;
        }
    }

    if (file_path == null) {
        std.debug.print(
            "Usage: rip [options] <file.rip>\n" ++
                "  -c, --compile  Compile to Zig source\n" ++
                "  -r, --run      Compile and run via zig\n" ++
                "  -t, --tokens   Dump token stream\n",
            .{},
        );
        std.process.exit(1);
    }

    const source = std.fs.cwd().readFileAlloc(allocator, file_path.?, 1024 * 1024) catch |err| {
        std.debug.print("Error reading {s}: {}\n", .{ file_path.?, err });
        std.process.exit(1);
    };
    defer allocator.free(source);

    switch (mode) {
        .parse => try parseAndPrint(allocator, source),
        .compile => try compileToStdout(allocator, source),
        .run => try compileAndRun(allocator, source, file_path.?),
        .tokens => dumpTokens(source),
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

fn compileToStdout(allocator: std.mem.Allocator, source: []const u8) !void {
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

fn compileAndRun(allocator: std.mem.Allocator, source: []const u8, rip_path: []const u8) !void {
    var p = parser.Parser.init(allocator, source);
    defer p.deinit();

    const result = p.parseProgram() catch {
        p.printError();
        std.process.exit(1);
    };

    var tmp_buf: [256]u8 = undefined;
    const tmp_path = makeTmpPath(&tmp_buf, rip_path);

    {
        const f = std.fs.cwd().createFile(tmp_path, .{}) catch |err| {
            std.debug.print("Error creating {s}: {}\n", .{ tmp_path, err });
            std.process.exit(1);
        };
        defer f.close();

        var c = Compiler.init(source);
        var file_buffer: [4096]u8 = undefined;
        var file_writer = f.writer(&file_buffer);
        const w: *std.Io.Writer = &file_writer.interface;
        try c.compile(result, w);
        try w.flush();
    }

    const argv = [_][]const u8{ "zig", "run", tmp_path };
    var child = std.process.Child.init(&argv, allocator);
    const term = try child.spawnAndWait();
    switch (term) {
        .Exited => |code| if (code != 0) {
            std.debug.print("note: generated Zig at {s}\n", .{tmp_path});
            std.process.exit(code);
        },
        else => std.process.exit(1),
    }
}

fn makeTmpPath(buf: []u8, rip_path: []const u8) []const u8 {
    var start: usize = 0;
    for (rip_path, 0..) |c, i| {
        if (c == '/' or c == '\\') start = i + 1;
    }
    var base = rip_path[start..];
    if (base.len > 4 and std.mem.eql(u8, base[base.len - 4 ..], ".rip")) {
        base = base[0 .. base.len - 4];
    }
    const prefix = "/tmp/rip_";
    const suffix = ".zig";
    if (prefix.len + base.len + suffix.len > buf.len) return "/tmp/_rip_out.zig";
    @memcpy(buf[0..prefix.len], prefix);
    @memcpy(buf[prefix.len..][0..base.len], base);
    @memcpy(buf[prefix.len + base.len ..][0..suffix.len], suffix);
    return buf[0 .. prefix.len + base.len + suffix.len];
}
