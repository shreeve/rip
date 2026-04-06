const std = @import("std");
const parser = @import("parser.zig");
const rip = @import("rip.zig");

pub fn main() !void {
    const allocator = std.heap.page_allocator;
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        std.debug.print("Usage: dump_tokens <file.rip>\n", .{});
        std.process.exit(1);
    }

    const source = std.fs.cwd().readFileAlloc(allocator, args[1], 1024 * 1024) catch |err| {
        std.debug.print("Error reading {s}: {any}\n", .{ args[1], err });
        std.process.exit(1);
    };
    defer allocator.free(source);

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
